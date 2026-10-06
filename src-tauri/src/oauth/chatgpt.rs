//! "Sign in with ChatGPT" for open-source apps (docs/OAUTH.md): dynamic client registration,
//! PKCE auth code with a 127.0.0.1 loopback redirect, rotating refresh.

use super::pkce;
use super::tokens::{now_ms, oauth_error_message, post_form, TokenSet};
use crate::error::{AppError, AppResult};

pub const AUTH_BASE: &str = "https://auth.openai.com";
pub const RESOURCE: &str = "https://api.openai.com/v1";
pub const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
pub const AGENT_NAME: &str = "AI Learning App";
pub const REFRESH_SKEW_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone)]
pub struct Endpoints {
    pub authorize: String,
    pub token: String,
}

impl Endpoints {
    pub fn with_base(base: &str) -> Self {
        let b = base.trim_end_matches('/');
        Self { authorize: format!("{b}/api/accounts/authorize"), token: format!("{b}/api/accounts/oauth/token") }
    }
}

impl Default for Endpoints {
    fn default() -> Self {
        Self::with_base(AUTH_BASE)
    }
}

#[derive(Debug, Clone)]
pub struct AuthRequest {
    pub url: String,
    pub state: String,
    pub verifier: String,
    pub redirect_uri: String,
}

/// `client_id` is the previously issued `oaiapp_…` id, or None for first-time dynamic registration.
pub fn build_authorize(ep: &Endpoints, client_id: Option<&str>, host_id: &str, redirect_uri: &str) -> AuthRequest {
    let verifier = pkce::verifier();
    let state = pkce::random_token(24);
    let nonce = pkce::random_token(24);
    let mut url = url::Url::parse(&ep.authorize).expect("valid authorize endpoint");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", client_id.unwrap_or(DYNAMIC_CLIENT));
        if client_id.is_none() {
            q.append_pair("agent_name_hint", AGENT_NAME);
        }
        q.append_pair("ext_agent_host_id", host_id);
        q.append_pair("redirect_uri", redirect_uri);
        q.append_pair("scope", SCOPE);
        q.append_pair("resource", RESOURCE);
        q.append_pair("state", &state);
        q.append_pair("nonce", &nonce);
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("code_challenge", &pkce::challenge(&verifier));
    }
    AuthRequest { url: url.into(), state, verifier, redirect_uri: redirect_uri.to_string() }
}

pub async fn exchange_code(
    http: &reqwest::Client,
    ep: &Endpoints,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> AppResult<TokenSet> {
    let form = [
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
        ("resource", RESOURCE),
    ];
    let v = post_form(http, &ep.token, &form)
        .await
        .map_err(|(s, b)| AppError::Other(oauth_error_message(s, &b)))?;
    let mut ts = TokenSet::from_response(&v, now_ms(), None)?;
    if ts.refresh.is_none() {
        return Err(AppError::Other("ChatGPT sign-in returned no refresh token".into()));
    }
    ts.client_id = Some(client_id.to_string());
    Ok(ts)
}

pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, ts: &TokenSet) -> AppResult<TokenSet> {
    let refresh = ts.refresh.as_deref().unwrap_or_default();
    let client_id = ts
        .client_id
        .as_deref()
        .ok_or_else(|| AppError::Other("ChatGPT sign-in is incomplete. Sign in again.".into()))?;
    let form = [("grant_type", "refresh_token"), ("refresh_token", refresh), ("client_id", client_id), ("resource", RESOURCE)];
    let v = post_form(http, &ep.token, &form).await.map_err(|(s, b)| {
        if s == 400 || s == 401 {
            AppError::Other("Your ChatGPT session expired. Sign in again in Settings.".into())
        } else {
            AppError::Other(oauth_error_message(s, &b))
        }
    })?;
    TokenSet::from_response(&v, now_ms(), Some(ts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn authorize_url_has_required_params() {
        let ep = Endpoints::default();
        let req = build_authorize(&ep, None, "host-1", "http://127.0.0.1:5555/auth/callback");
        let url = url::Url::parse(&req.url).unwrap();
        assert_eq!(url.host_str(), Some("auth.openai.com"));
        assert_eq!(url.path(), "/api/accounts/authorize");
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "dynamic_agent_client");
        assert_eq!(q["agent_name_hint"], AGENT_NAME);
        assert_eq!(q["ext_agent_host_id"], "host-1");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555/auth/callback");
        assert_eq!(q["scope"], SCOPE);
        assert_eq!(q["resource"], RESOURCE);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], pkce::challenge(&req.verifier));
        assert_eq!(q["state"], req.state);
        assert!(q.contains_key("nonce"));

        let again = build_authorize(&ep, Some("oaiapp_1"), "host-1", "http://127.0.0.1:1/auth/callback");
        let q: HashMap<_, _> = url::Url::parse(&again.url).unwrap().query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "oaiapp_1");
        assert!(!q.contains_key("agent_name_hint"));
    }

    #[tokio::test]
    async fn exchanges_code() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/accounts/oauth/token"))
            .and(body_string_contains("grant_type=authorization_code"))
            .and(body_string_contains("client_id=oaiapp_abc"))
            .and(body_string_contains("code=the-code"))
            .and(body_string_contains("code_verifier=ver"))
            .and(body_string_contains("resource=https%3A%2F%2Fapi.openai.com%2Fv1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "access_token": "at", "refresh_token": "rt", "expires_in": 3600, "token_type": "Bearer"
            })))
            .expect(1)
            .mount(&server)
            .await;
        let ep = Endpoints::with_base(&server.uri());
        let ts = exchange_code(&reqwest::Client::new(), &ep, "oaiapp_abc", "the-code", "ver", "http://127.0.0.1:9/auth/callback")
            .await
            .unwrap();
        assert_eq!(ts.access, "at");
        assert_eq!(ts.refresh.as_deref(), Some("rt"));
        assert_eq!(ts.client_id.as_deref(), Some("oaiapp_abc"));
    }

    #[tokio::test]
    async fn refresh_rotation_persists_new_token() {
        use super::super::tokens::TokenManager;
        use crate::secrets::MemoryStore;
        use std::sync::Arc;

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/accounts/oauth/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=r1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "access_token": "a2", "refresh_token": "r2", "expires_in": 3600
            })))
            .expect(1)
            .mount(&server)
            .await;
        let tm = TokenManager::new(Arc::new(MemoryStore::default()));
        tm.save("p", &TokenSet { access: "a1".into(), refresh: Some("r1".into()), expires_at: 1, account: Some("me@x.com".into()), client_id: Some("oaiapp_1".into()), obtained_at: None })
            .unwrap();
        let ep = Endpoints::with_base(&server.uri());
        let http = reqwest::Client::new();
        let ts = tm.valid("p", |_| REFRESH_SKEW_MS, |old| async move { refresh(&http, &ep, &old).await }).await.unwrap();
        assert_eq!(ts.access, "a2");
        let stored = tm.load("p").unwrap().unwrap();
        assert_eq!(stored.refresh.as_deref(), Some("r2"));
        assert_eq!(stored.client_id.as_deref(), Some("oaiapp_1"));
        assert_eq!(stored.account.as_deref(), Some("me@x.com"));
        // second call uses the stored token without another refresh (expect(1) above)
        let again = tm.valid("p", |_| REFRESH_SKEW_MS, |_| async { Err(AppError::Other("no".into())) }).await.unwrap();
        assert_eq!(again.access, "a2");
    }
}
