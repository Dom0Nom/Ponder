use super::{dropbox, CloudImportResult, CloudItem, CloudPage, CloudServices, CloudStatus, Service, MAX_DOWNLOAD_BYTES};
use crate::error::{AppError, AppResult};
use crate::ingest::Ingest;
use crate::oauth::loopback::Loopback;
use crate::AppState;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub type Cloud = Arc<CloudServices>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAuthStart {
    pub auth_url: String,
}

fn emit(app: &AppHandle, cloud: &CloudServices, svc: Service) -> AppResult<CloudStatus> {
    let s = cloud.status(svc)?;
    let _ = app.emit("cloud://status", &s);
    Ok(s)
}

#[tauri::command]
pub async fn cloud_status(cloud: State<'_, Cloud>, service: Service) -> AppResult<CloudStatus> {
    let c = cloud.inner().clone();
    tokio::task::spawn_blocking(move || c.status(service)).await.map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
pub async fn cloud_set_client(
    app: AppHandle,
    cloud: State<'_, Cloud>,
    service: Service,
    client_id: String,
    client_secret: Option<String>,
) -> AppResult<CloudStatus> {
    let c = cloud.inner().clone();
    tokio::task::spawn_blocking(move || {
        c.set_client(service, &client_id, client_secret.as_deref())?;
        emit(&app, &c, service)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
pub async fn cloud_connect(app: AppHandle, cloud: State<'_, Cloud>, service: Service) -> AppResult<CloudAuthStart> {
    let cloud = cloud.inner().clone();
    let client = cloud.require_client(service)?;
    let lb = match service {
        Service::Google => Loopback::bind().await?,
        Service::Dropbox => Loopback::bind_port(dropbox::REDIRECT_PORT).await?,
    };
    let req = cloud.build_authorize(service, &client, &lb.redirect_uri());
    let pid = service.account();
    cloud.oauth.set_transient(cloud.oauth.pending_status(pid));
    emit(&app, &cloud, service)?;

    let auth_url = req.url.clone();
    let task_app = app.clone();
    let task_cloud = cloud.clone();
    let task = tokio::spawn(async move {
        let result = async {
            let cb = lb.wait(&req.state, SIGN_IN_TIMEOUT).await?;
            task_cloud.finish_sign_in(service, &client, &req, &cb.code).await
        }
        .await;
        match result {
            Ok(_) => task_cloud.oauth.clear_transient(pid),
            Err(e) => {
                log::warn!("{} sign-in failed: {e}", service.label());
                task_cloud.oauth.set_transient(task_cloud.oauth.error_status(pid, e.to_string()));
            }
        }
        let _ = emit(&task_app, &task_cloud, service);
    });
    cloud.oauth.track_flow(pid, task.abort_handle());

    if let Err(e) = app.opener().open_url(auth_url.clone(), None::<&str>) {
        log::warn!("couldn't open browser for sign-in: {e}");
    }
    Ok(CloudAuthStart { auth_url })
}

#[tauri::command]
pub async fn cloud_disconnect(app: AppHandle, cloud: State<'_, Cloud>, service: Service) -> AppResult<CloudStatus> {
    let cloud = cloud.inner().clone();
    cloud.disconnect(service).await?;
    emit(&app, &cloud, service)
}

#[tauri::command]
pub async fn cloud_list(
    app: AppHandle,
    cloud: State<'_, Cloud>,
    service: Service,
    folder: Option<String>,
    query: Option<String>,
    page_token: Option<String>,
) -> AppResult<CloudPage> {
    let cloud = cloud.inner().clone();
    let before = cloud.oauth.status(service.account()).map(|s| s.state).unwrap_or("signedOut");
    let result = cloud.list(service, folder.as_deref(), query.as_deref(), page_token.as_deref()).await;
    if cloud.oauth.status(service.account()).map(|s| s.state).unwrap_or("signedOut") != before {
        let _ = emit(&app, &cloud, service);
    }
    result
}

#[tauri::command]
pub async fn cloud_import(
    state: State<'_, AppState>,
    ingest: State<'_, Ingest>,
    cloud: State<'_, Cloud>,
    service: Service,
    space_id: String,
    items: Vec<CloudItem>,
) -> AppResult<CloudImportResult> {
    let cloud = cloud.inner().clone();
    let ingest = ingest.inner().clone();
    let imports = state.data_dir.join("imports");
    // a separate task keeps the downloads off the IPC handler
    tokio::spawn(async move { cloud.import(&ingest, service, &space_id, &items, &imports, MAX_DOWNLOAD_BYTES).await })
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}
