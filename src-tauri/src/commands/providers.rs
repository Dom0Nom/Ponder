use crate::db::models::{self as m, Provider};
use crate::error::{invalid, AppError, AppResult};
use crate::lan::{self, LanServer};
use crate::oauth::{chatgpt, loopback::Loopback, xai, OAuth, OAuthStatus};
use crate::proxy::{self, FetchedPage, Inflight, ProxyEvent, ProxyRequest};
use crate::secrets::{self, SecretStore};
use crate::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

const PROVIDER_TYPES: &[&str] = &[
    "anthropic", "openai", "google", "openrouter", "xai", "groq", "mistral", "deepseek", "openai-compatible", "lmstudio", "ollama",
    "llamacpp", "chatgpt-oauth", "xai-oauth",
];
const CHATGPT_SETTING: &str = "chatgptOAuth";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub struct ProviderServices {
    pub secrets: Arc<dyn SecretStore>,
    pub oauth: Arc<OAuth>,
    pub stream_http: reqwest::Client,
    pub page_http: reqwest::Client,
    pub inflight: Inflight,
}

impl ProviderServices {
    pub fn new() -> Self {
        let secrets: Arc<dyn SecretStore> = secrets::default_store();
        Self {
            oauth: Arc::new(OAuth::new(secrets.clone())),
            secrets,
            stream_http: proxy::stream_client(),
            page_http: proxy::page_client(),
            inflight: Inflight::default(),
        }
    }
}

fn emit_status(app: &AppHandle, s: &OAuthStatus) {
    let _ = app.emit("oauth://status", s);
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::Other(e.to_string()))?
}

// ---------- providers ----------

#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> AppResult<Vec<Provider>> {
    m::list_providers(&state.db.conn()?)
}

#[tauri::command]
pub async fn save_provider(state: State<'_, AppState>, mut provider: Provider) -> AppResult<Provider> {
    if !PROVIDER_TYPES.contains(&provider.provider_type.as_str()) {
        return Err(invalid(format!("Unknown provider type {}", provider.provider_type)));
    }
    if !matches!(provider.kind.as_str(), "apiKey" | "oauth" | "local") {
        return Err(invalid("Unknown provider kind"));
    }
    provider.base_url = provider
        .base_url
        .map(|b| b.trim().trim_end_matches('/').to_string())
        .filter(|b| !b.is_empty());
    if let Some(b) = &provider.base_url {
        let ok = url::Url::parse(b).map(|u| matches!(u.scheme(), "http" | "https") && u.host().is_some()).unwrap_or(false);
        if !ok {
            return Err(invalid("Base URL must start with http:// or https://"));
        }
    }
    if provider.config.is_null() {
        provider.config = json!({});
    }
    m::save_provider(&state.db.conn()?, provider)
}

#[tauri::command]
pub async fn delete_provider(state: State<'_, AppState>, svc: State<'_, ProviderServices>, id: String) -> AppResult<()> {
    m::delete_provider(&state.db.conn()?, &id)?;
    svc.oauth.cancel_flow(&id);
    svc.oauth.clear_transient(&id);
    let store = svc.secrets.clone();
    blocking(move || secrets::delete_all(store.as_ref(), &id)).await
}

// ---------- secrets ----------

#[tauri::command]
pub async fn secret_set(svc: State<'_, ProviderServices>, provider_id: String, value: String) -> AppResult<()> {
    let store = svc.secrets.clone();
    blocking(move || secrets::set_api_key(store.as_ref(), &provider_id, &value)).await
}

#[tauri::command]
pub async fn secret_has(svc: State<'_, ProviderServices>, provider_id: String) -> AppResult<bool> {
    let store = svc.secrets.clone();
    blocking(move || Ok(store.get(&provider_id)?.is_some())).await
}

#[tauri::command]
pub async fn secret_delete(svc: State<'_, ProviderServices>, provider_id: String) -> AppResult<()> {
    let store = svc.secrets.clone();
    blocking(move || store.delete(&provider_id)).await
}

// ---------- LAN ----------

#[tauri::command]
pub async fn lan_scan() -> AppResult<Vec<LanServer>> {
    Ok(lan::scan().await)
}

// ---------- OAuth ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStart {
    pub auth_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeStart {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
}

fn oauth_provider(state: &AppState, id: &str, expected_type: &str) -> AppResult<Provider> {
    let p = m::get_provider(&state.db.conn()?, id)?;
    if p.provider_type != expected_type {
        return Err(invalid("This provider doesn't use that sign-in method"));
    }
    Ok(p)
}

/// Stores the signed-in account on the provider so cards can show it without a keychain read.
fn record_account(app: &AppHandle, provider_id: &str, account: Option<&str>) {
    let state = app.state::<AppState>();
    let Ok(conn) = state.db.conn() else { return };
    if let Ok(mut p) = m::get_provider(&conn, provider_id) {
        if !p.config.is_object() {
            p.config = json!({});
        }
        p.config["account"] = account.map(|a| Value::String(a.into())).unwrap_or(Value::Null);
        let _ = m::save_provider(&conn, p);
    }
}

fn chatgpt_registration(state: &AppState) -> AppResult<(String, Option<String>)> {
    let conn = state.db.conn()?;
    let mut v = m::get_setting(&conn, CHATGPT_SETTING)?.unwrap_or_else(|| json!({}));
    let host_id = match v.get("hostId").and_then(Value::as_str) {
        Some(h) => h.to_string(),
        None => {
            let h = uuid::Uuid::new_v4().to_string();
            v["hostId"] = Value::String(h.clone());
            m::set_setting(&conn, CHATGPT_SETTING, &v)?;
            h
        }
    };
    let client_id = v.get("clientId").and_then(Value::as_str).map(str::to_string);
    Ok((host_id, client_id))
}

fn save_chatgpt_client_id(app: &AppHandle, client_id: &str) -> AppResult<()> {
    let state = app.state::<AppState>();
    let conn = state.db.conn()?;
    let mut v = m::get_setting(&conn, CHATGPT_SETTING)?.unwrap_or_else(|| json!({}));
    v["clientId"] = Value::String(client_id.into());
    m::set_setting(&conn, CHATGPT_SETTING, &v)
}

fn finish_flow(app: &AppHandle, oauth: &OAuth, provider_id: &str, result: AppResult<Option<String>>) {
    match result {
        Ok(account) => {
            oauth.clear_transient(provider_id);
            record_account(app, provider_id, account.as_deref());
            if let Ok(s) = oauth.status(provider_id) {
                emit_status(app, &s);
            }
        }
        Err(e) => {
            log::warn!("sign-in failed for provider {provider_id}: {e}");
            let s = oauth.error_status(provider_id, e.to_string());
            oauth.set_transient(s.clone());
            emit_status(app, &s);
        }
    }
}

#[tauri::command]
pub async fn oauth_chatgpt_start(
    app: AppHandle,
    state: State<'_, AppState>,
    svc: State<'_, ProviderServices>,
    provider_id: String,
) -> AppResult<AuthStart> {
    oauth_provider(&state, &provider_id, "chatgpt-oauth")?;
    let (host_id, client_id) = chatgpt_registration(&state)?;
    let oauth = svc.oauth.clone();
    let lb = Loopback::bind().await?;
    let req = chatgpt::build_authorize(&oauth.chatgpt, client_id.as_deref(), &host_id, &lb.redirect_uri());
    let pending = oauth.pending_status(&provider_id);
    oauth.set_transient(pending.clone());
    emit_status(&app, &pending);

    let auth_url = req.url.clone();
    let task_app = app.clone();
    let task_oauth = oauth.clone();
    let pid = provider_id.clone();
    let task = tokio::spawn(async move {
        let result = async {
            let cb = lb.wait(&req.state, SIGN_IN_TIMEOUT).await?;
            let cid = cb
                .params
                .get("client_id")
                .cloned()
                .or(client_id)
                .ok_or_else(|| AppError::Other("ChatGPT didn't return a client id. Try again.".into()))?;
            let ts = chatgpt::exchange_code(&task_oauth.http, &task_oauth.chatgpt, &cid, &cb.code, &req.verifier, &req.redirect_uri).await?;
            task_oauth.tokens.save(&pid, &ts)?;
            save_chatgpt_client_id(&task_app, &cid)?;
            Ok(ts.account)
        }
        .await;
        finish_flow(&task_app, &task_oauth, &pid, result);
    });
    oauth.track_flow(&provider_id, task.abort_handle());

    if let Err(e) = app.opener().open_url(auth_url.clone(), None::<&str>) {
        log::warn!("couldn't open browser for sign-in: {e}");
    }
    Ok(AuthStart { auth_url })
}

#[tauri::command]
pub async fn oauth_xai_device_start(
    app: AppHandle,
    state: State<'_, AppState>,
    svc: State<'_, ProviderServices>,
    provider_id: String,
) -> AppResult<DeviceCodeStart> {
    oauth_provider(&state, &provider_id, "xai-oauth")?;
    let oauth = svc.oauth.clone();
    let disc = xai::discover(&oauth.http, &oauth.xai).await?;
    let start = xai::request_device_code(&oauth.http, &disc).await?;
    let pending = oauth.pending_status(&provider_id);
    oauth.set_transient(pending.clone());
    emit_status(&app, &pending);

    let out = DeviceCodeStart {
        user_code: start.user_code.clone(),
        verification_uri: start.verification_uri.clone(),
        verification_uri_complete: start.verification_uri_complete.clone(),
        expires_in: start.expires_in,
    };
    let task_app = app.clone();
    let task_oauth = oauth.clone();
    let pid = provider_id.clone();
    let task = tokio::spawn(async move {
        let result = async {
            let ts = xai::poll_token(&task_oauth.http, &disc, &start.device_code, xai::poll_config(&start)).await?;
            task_oauth.tokens.save(&pid, &ts)?;
            Ok(ts.account)
        }
        .await;
        finish_flow(&task_app, &task_oauth, &pid, result);
    });
    oauth.track_flow(&provider_id, task.abort_handle());
    Ok(out)
}

#[tauri::command]
pub async fn oauth_status(svc: State<'_, ProviderServices>, provider_id: String) -> AppResult<OAuthStatus> {
    let oauth = svc.oauth.clone();
    blocking(move || oauth.status(&provider_id)).await
}

#[tauri::command]
pub async fn oauth_sign_out(app: AppHandle, svc: State<'_, ProviderServices>, provider_id: String) -> AppResult<()> {
    let oauth = svc.oauth.clone();
    let pid = provider_id.clone();
    blocking(move || oauth.sign_out(&pid)).await?;
    record_account(&app, &provider_id, None);
    emit_status(&app, &OAuthStatus { provider_id, state: "signedOut", account: None, error: None, expires_at: None });
    Ok(())
}

// ---------- HTTP proxy ----------

#[tauri::command]
pub async fn http_stream(
    state: State<'_, AppState>,
    svc: State<'_, ProviderServices>,
    request: ProxyRequest,
    on_event: Channel<ProxyEvent>,
) -> AppResult<()> {
    let id = request.id.clone();
    let cancel = svc.inflight.register(&id);
    let send = |e: ProxyEvent| {
        let _ = on_event.send(e);
    };
    let prepared = async {
        let provider = match request.provider_id.as_deref().filter(|s| !s.is_empty()) {
            Some(pid) => Some(m::get_provider(&state.db.conn()?, pid)?),
            None => None,
        };
        proxy::prepare(&request, provider.as_ref(), svc.secrets.as_ref(), &svc.oauth).await
    }
    .await;
    match prepared {
        Ok(p) => proxy::run(&svc.stream_http, p, cancel, send).await,
        Err(e) => send(ProxyEvent::Error { message: e.to_string() }),
    }
    svc.inflight.done(&id);
    Ok(())
}

#[tauri::command]
pub async fn http_abort(svc: State<'_, ProviderServices>, id: String) -> AppResult<()> {
    svc.inflight.abort(&id);
    Ok(())
}

#[tauri::command]
pub async fn http_get_text(
    svc: State<'_, ProviderServices>,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> AppResult<FetchedPage> {
    proxy::get_text(&svc.page_http, &url, headers).await
}

#[tauri::command]
pub async fn list_openrouter_models(
    state: State<'_, AppState>,
    svc: State<'_, ProviderServices>,
    force: Option<bool>,
) -> AppResult<crate::openrouter::OpenRouterCatalog> {
    crate::openrouter::load(&svc.page_http, &state.data_dir, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn site_icon(state: State<'_, AppState>, host: String) -> AppResult<Option<String>> {
    crate::icons::site_icon(&state.data_dir, &host).await
}
