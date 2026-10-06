//! xAI / Grok sign-in via device code (docs/OAUTH.md). Reuses the Grok CLI public client.

use super::device::{self, DeviceError, PollConfig};
use super::tokens::{now_ms, oauth_error_message, post_form, TokenSet};
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

pub const DISCOVERY_URL: &str = "https://auth.x.ai/.well-known/openid-configuration";
pub const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
pub const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
pub const PLAN_ERROR: &str = "Your plan doesn't include API access. xAI sign-in needs SuperGrok or X Premium+ with API access; use an xAI API key instead.";

#[derive(Debug, Clone)]
pub struct Endpoints {
    pub discovery: String,
    /// Refuse discovered endpoints that aren't HTTPS on x.ai (off in tests).
    pub enforce_origin: bool,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self { discovery: DISCOVERY_URL.into(), enforce_origin: true }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Discovery {
    pub device_authorization_endpoint: String,
    pub token_endpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(default)]
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    #[serde(default = "default_interval")]
    pub interval: u64,
}

fn default_interval() -> u64 {
    5
}

fn on_xai_origin(u: &str) -> bool {
    url::Url::parse(u)
        .ok()
        .filter(|u| u.scheme() == "https")
        .and_then(|u| u.host_str().map(|h| h == "x.ai" || h.ends_with(".x.ai")))
        .unwrap_or(false)
}

pub async fn discover(http: &reqwest::Client, ep: &Endpoints) -> AppResult<Discovery> {
    let resp = http.get(&ep.discovery).header("Accept", "application/json").send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("xAI sign-in discovery failed (HTTP {})", resp.status().as_u16())));
    }
    let d: Discovery = resp
        .json()
        .await
        .map_err(|_| AppError::Other("xAI sign-in discovery returned an unexpected document".into()))?;
    if ep.enforce_origin && !(on_xai_origin(&d.device_authorization_endpoint) && on_xai_origin(&d.token_endpoint)) {
        return Err(AppError::Other("xAI sign-in discovery pointed outside x.ai; refusing".into()));
    }
    Ok(d)
}

pub async fn request_device_code(http: &reqwest::Client, d: &Discovery) -> AppResult<DeviceStart> {
    let v = post_form(http, &d.device_authorization_endpoint, &[("client_id", CLIENT_ID), ("scope", SCOPE)])
        .await
        .map_err(|(s, b)| {
            if s == 403 {
                AppError::Other(PLAN_ERROR.into())
            } else {
                AppError::Other(oauth_error_message(s, &b))
            }
        })?;
    serde_json::from_value(v).map_err(|_| AppError::Other("xAI device-code response was missing fields".into()))
}

pub fn poll_config(start: &DeviceStart) -> PollConfig {
    PollConfig {
        interval: Duration::from_secs(start.interval.max(1)),
        slow_down_step: Duration::from_secs(5),
        expires_in: Duration::from_secs(start.expires_in),
    }
}

pub async fn poll_token(http: &reqwest::Client, d: &Discovery, device_code: &str, cfg: PollConfig) -> AppResult<TokenSet> {
    let form = [("grant_type", device::GRANT_TYPE), ("client_id", CLIENT_ID), ("device_code", device_code)];
    let v: Value = device::poll(http, &d.token_endpoint, &form, cfg).await.map_err(|e| match e {
        DeviceError::Denied => AppError::Other("Sign-in was declined.".into()),
        DeviceError::Expired => AppError::Other("The code expired before it was approved. Try again.".into()),
        DeviceError::Forbidden(_) => AppError::Other(PLAN_ERROR.into()),
        DeviceError::Other(m) => AppError::Other(format!("xAI sign-in failed: {m}")),
    })?;
    let ts = TokenSet::from_response(&v, now_ms(), None)?;
    if ts.refresh.is_none() {
        return Err(AppError::Other("xAI sign-in returned no refresh token".into()));
    }
    Ok(ts)
}

pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, ts: &TokenSet) -> AppResult<TokenSet> {
    let d = discover(http, ep).await?;
    let refresh = ts.refresh.as_deref().unwrap_or_default();
    let form = [("grant_type", "refresh_token"), ("client_id", CLIENT_ID), ("refresh_token", refresh)];
    let v = post_form(http, &d.token_endpoint, &form).await.map_err(|(s, b)| match s {
        403 => AppError::Other(PLAN_ERROR.into()),
        400 | 401 => AppError::Other("Your xAI session expired. Sign in again in Settings.".into()),
        _ => AppError::Other(oauth_error_message(s, &b)),
    })?;
    TokenSet::from_response(&v, now_ms(), Some(ts))
}

/// Refresh an hour early, but device-code logins can return ~15 min tokens; refreshing an hour
/// early there would burn a single-use refresh token on every request.
pub fn refresh_skew_ms(ts: &TokenSet) -> i64 {
    const HOUR: i64 = 3_600_000;
    match ts.obtained_at {
        Some(at) if ts.expires_at - at <= 45 * 60_000 => 2 * 60_000,
        _ => HOUR,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oauth::tokens::TokenManager;
    use crate::secrets::MemoryStore;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

    async fn server_with_discovery() -> (MockServer, Endpoints) {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/.well-known/openid-configuration"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "device_authorization_endpoint": format!("{}/oauth2/device/code", server.uri()),
                "token_endpoint": format!("{}/oauth2/token", server.uri()),
            })))
            .mount(&server)
            .await;
        let ep = Endpoints { discovery: format!("{}/.well-known/openid-configuration", server.uri()), enforce_origin: false };
        (server, ep)
    }

    struct Sequence(AtomicUsize, Vec<ResponseTemplate>);
    impl Respond for Sequence {
        fn respond(&self, _: &Request) -> ResponseTemplate {
            let i = self.0.fetch_add(1, Ordering::SeqCst);
            self.1[i.min(self.1.len() - 1)].clone()
        }
    }

    fn fast(start: &DeviceStart) -> PollConfig {
        PollConfig { interval: Duration::from_millis(10), slow_down_step: Duration::from_millis(40), expires_in: Duration::from_secs(start.expires_in) }
    }

    #[tokio::test]
    async fn device_flow_pending_slow_down_success() {
        let (server, ep) = server_with_discovery().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/device/code"))
            .and(body_string_contains("client_id=b1a00492"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "device_code": "dc", "user_code": "ABCD-EFGH", "verification_uri": "https://accounts.x.ai/device",
                "verification_uri_complete": "https://accounts.x.ai/device?code=ABCD-EFGH", "expires_in": 600, "interval": 5
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("device_code=dc"))
            .and(body_string_contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"))
            .respond_with(Sequence(
                AtomicUsize::new(0),
                vec![
                    ResponseTemplate::new(400).set_body_json(json!({"error": "authorization_pending"})),
                    ResponseTemplate::new(400).set_body_json(json!({"error": "slow_down"})),
                    ResponseTemplate::new(200).set_body_json(json!({"access_token": "at", "refresh_token": "rt", "expires_in": 21600})),
                ],
            ))
            .expect(3)
            .mount(&server)
            .await;
        let http = reqwest::Client::new();
        let d = discover(&http, &ep).await.unwrap();
        let start = request_device_code(&http, &d).await.unwrap();
        assert_eq!(start.user_code, "ABCD-EFGH");
        assert_eq!(poll_config(&start).interval, Duration::from_secs(5));
        let t0 = std::time::Instant::now();
        let ts = poll_token(&http, &d, &start.device_code, fast(&start)).await.unwrap();
        // 10ms + 10ms + (10+40)ms: the slow_down bumped the interval
        assert!(t0.elapsed() >= Duration::from_millis(70));
        assert_eq!(ts.access, "at");
        assert_eq!(ts.refresh.as_deref(), Some("rt"));
        assert_eq!(refresh_skew_ms(&ts), 3_600_000);
    }

    #[tokio::test]
    async fn device_flow_expired_and_denied() {
        let (server, ep) = server_with_discovery().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("device_code=expired"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error": "expired_token"})))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("device_code=denied"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error": "access_denied"})))
            .mount(&server)
            .await;
        let http = reqwest::Client::new();
        let d = discover(&http, &ep).await.unwrap();
        let cfg = PollConfig { interval: Duration::from_millis(5), slow_down_step: Duration::from_millis(5), expires_in: Duration::from_secs(5) };
        let e = poll_token(&http, &d, "expired", cfg.clone()).await.unwrap_err().to_string();
        assert!(e.contains("expired"), "{e}");
        let e = poll_token(&http, &d, "denied", cfg.clone()).await.unwrap_err().to_string();
        assert!(e.contains("declined"), "{e}");
        // local deadline also ends polling
        let short = PollConfig { interval: Duration::from_millis(50), slow_down_step: Duration::ZERO, expires_in: Duration::from_millis(10) };
        assert!(poll_token(&http, &d, "x", short).await.unwrap_err().to_string().contains("expired"));
    }

    #[tokio::test]
    async fn forbidden_maps_to_plan_error() {
        let (server, ep) = server_with_discovery().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .respond_with(ResponseTemplate::new(403).set_body_string("forbidden"))
            .mount(&server)
            .await;
        let http = reqwest::Client::new();
        let ts = TokenSet { access: "a".into(), refresh: Some("r".into()), expires_at: 1, account: None, client_id: None, obtained_at: None };
        let e = refresh(&http, &ep, &ts).await.unwrap_err().to_string();
        assert!(e.contains("plan doesn't include API access"), "{e}");
        let d = discover(&http, &ep).await.unwrap();
        let cfg = PollConfig { interval: Duration::from_millis(5), slow_down_step: Duration::ZERO, expires_in: Duration::from_secs(5) };
        let e = poll_token(&http, &d, "dc", cfg).await.unwrap_err().to_string();
        assert!(e.contains("plan doesn't include API access"), "{e}");
    }

    #[tokio::test]
    async fn refresh_rotation_persists_before_use() {
        let (server, ep) = server_with_discovery().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=r1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"access_token": "a2", "refresh_token": "r2", "expires_in": 21600})))
            .expect(1)
            .mount(&server)
            .await;
        let tm = TokenManager::new(Arc::new(MemoryStore::default()));
        let now = now_ms();
        // 6h token obtained 5.5h ago: inside the 1h window
        tm.save("x", &TokenSet { access: "a1".into(), refresh: Some("r1".into()), expires_at: now + 30 * 60_000, account: None, client_id: None, obtained_at: Some(now - 330 * 60_000) })
            .unwrap();
        let http = reqwest::Client::new();
        let ts = tm.valid("x", refresh_skew_ms, |old| async move { refresh(&http, &ep, &old).await }).await.unwrap();
        assert_eq!(ts.access, "a2");
        assert_eq!(tm.load("x").unwrap().unwrap().refresh.as_deref(), Some("r2"));
    }

    #[test]
    fn short_tokens_use_small_skew() {
        let ts = TokenSet { access: "a".into(), refresh: None, expires_at: 15 * 60_000, account: None, client_id: None, obtained_at: Some(0) };
        assert_eq!(refresh_skew_ms(&ts), 120_000);
    }

    #[test]
    fn origin_check() {
        assert!(on_xai_origin("https://auth.x.ai/oauth2/token"));
        assert!(!on_xai_origin("http://auth.x.ai/oauth2/token"));
        assert!(!on_xai_origin("https://evilx.ai/oauth2/token"));
    }
}
