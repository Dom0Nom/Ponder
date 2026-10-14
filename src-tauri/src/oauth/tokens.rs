//! OAuth token sets in the keychain, with single-flight rotating refresh.

use crate::error::{AppError, AppResult};
use crate::secrets::{oauth_account, SecretStore};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenSet {
    pub access: String,
    pub refresh: Option<String>,
    /// ms since epoch; 0 = unknown
    pub expires_at: i64,
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub obtained_at: Option<i64>,
}

pub fn now_ms() -> i64 {
    crate::db::now_ms()
}

/// Decodes a JWT payload without verifying it. Only used for display (email) and expiry hints,
/// never for authorization decisions.
pub fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    serde_json::from_slice(&bytes).ok()
}

impl TokenSet {
    /// Builds a token set from a token endpoint response. `prev` supplies the refresh token,
    /// account and client id when the response omits them.
    pub fn from_response(v: &Value, now: i64, prev: Option<&TokenSet>) -> AppResult<TokenSet> {
        let access = v
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Other("Token response had no access token".into()))?
            .to_string();
        let refresh = v
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| prev.and_then(|p| p.refresh.clone()));
        let expires_at = match v
            .get("expires_in")
            .and_then(|e| e.as_i64().or_else(|| e.as_str()?.parse().ok()))
        {
            Some(secs) => now + secs * 1000,
            None => jwt_claims(&access)
                .and_then(|c| c.get("exp").and_then(Value::as_i64))
                .map(|exp| exp * 1000)
                .unwrap_or(now + 3600 * 1000),
        };
        let account = v
            .get("id_token")
            .and_then(Value::as_str)
            .and_then(jwt_claims)
            .and_then(|c| {
                c.get("email")
                    .or_else(|| c.get("name"))
                    .or_else(|| c.get("sub"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| prev.and_then(|p| p.account.clone()));
        Ok(TokenSet {
            access,
            refresh,
            expires_at,
            account,
            client_id: prev.and_then(|p| p.client_id.clone()),
            obtained_at: Some(now),
        })
    }

    pub fn needs_refresh(&self, now: i64, skew_ms: i64) -> bool {
        self.expires_at != 0 && now + skew_ms >= self.expires_at
    }
}

/// POSTs a form to a token endpoint. Err carries (status, body).
pub async fn post_form(
    http: &reqwest::Client,
    url: &str,
    form: &[(&str, &str)],
) -> Result<Value, (u16, String)> {
    let resp = http
        .post(url)
        .header("Accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|e| (0, e.to_string()))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err((status, body));
    }
    serde_json::from_str(&body)
        .map_err(|_| (status, "Token endpoint returned invalid JSON".to_string()))
}

pub fn oauth_error_message(status: u16, body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let desc = parsed
        .as_ref()
        .and_then(|v| v.get("error_description").or_else(|| v.get("error")))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| body.chars().take(200).collect());
    if status == 0 {
        format!("Couldn't reach the sign-in server: {desc}")
    } else {
        format!("Sign-in server returned HTTP {status}: {desc}")
    }
}

pub struct TokenManager {
    store: Arc<dyn SecretStore>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl TokenManager {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn load(&self, provider_id: &str) -> AppResult<Option<TokenSet>> {
        match self.store.get(&oauth_account(provider_id))? {
            None => Ok(None),
            Some(s) => Ok(serde_json::from_str(&s).ok()),
        }
    }

    pub fn save(&self, provider_id: &str, ts: &TokenSet) -> AppResult<()> {
        self.store
            .set(&oauth_account(provider_id), &serde_json::to_string(ts)?)
    }

    pub fn clear(&self, provider_id: &str) -> AppResult<()> {
        self.store.delete(&oauth_account(provider_id))
    }

    fn lock_for(&self, provider_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks
            .lock()
            .unwrap()
            .entry(provider_id.to_string())
            .or_default()
            .clone()
    }

    /// Returns a valid token set, refreshing it first when it expires within `skew_ms(ts)`.
    /// Single-flight per provider: concurrent callers wait and then read the rotated set from the
    /// store, so a single-use refresh token is never sent twice. The new set is persisted before
    /// it's returned.
    pub async fn valid<S, F, Fut>(
        &self,
        provider_id: &str,
        skew_ms: S,
        refresh: F,
    ) -> AppResult<TokenSet>
    where
        S: Fn(&TokenSet) -> i64,
        F: FnOnce(TokenSet) -> Fut,
        Fut: Future<Output = AppResult<TokenSet>>,
    {
        let lock = self.lock_for(provider_id);
        let _guard = lock.lock().await;
        let ts = self
            .load(provider_id)?
            .ok_or_else(|| crate::error::keyed("other", "notSignedIn", Vec::new(), "Not signed in. Sign in again in Settings."))?;
        if !ts.needs_refresh(now_ms(), skew_ms(&ts)) {
            return Ok(ts);
        }
        if ts.refresh.is_none() {
            return Err(crate::error::keyed(
                "other",
                "sessionExpired",
                Vec::new(),
                "Session expired. Sign in again in Settings.",
            ));
        }
        let mut fresh = refresh(ts.clone()).await?;
        if fresh.refresh.is_none() {
            fresh.refresh = ts.refresh.clone();
        }
        if fresh.client_id.is_none() {
            fresh.client_id = ts.client_id.clone();
        }
        if fresh.account.is_none() {
            fresh.account = ts.account.clone();
        }
        self.save(provider_id, &fresh)?;
        Ok(fresh)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn jwt(claims: Value) -> String {
        format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    #[test]
    fn parses_token_response() {
        let v = json!({"access_token": "a", "refresh_token": "r", "expires_in": 3600, "id_token": jwt(json!({"email": "me@x.com"}))});
        let ts = TokenSet::from_response(&v, 1_000, None).unwrap();
        assert_eq!(ts.access, "a");
        assert_eq!(ts.refresh.as_deref(), Some("r"));
        assert_eq!(ts.expires_at, 1_000 + 3_600_000);
        assert_eq!(ts.account.as_deref(), Some("me@x.com"));
        assert!(ts.needs_refresh(1_000 + 3_600_000 - 1000, 5 * 60_000));
        assert!(!ts.needs_refresh(1_000, 5 * 60_000));
    }

    #[test]
    fn keeps_previous_refresh_when_not_rotated() {
        let prev = TokenSet {
            access: "o".into(),
            refresh: Some("r0".into()),
            expires_at: 0,
            account: Some("acc".into()),
            client_id: Some("c".into()),
            obtained_at: None,
        };
        let ts = TokenSet::from_response(&json!({"access_token": "n"}), 0, Some(&prev)).unwrap();
        assert_eq!(ts.refresh.as_deref(), Some("r0"));
        assert_eq!(ts.client_id.as_deref(), Some("c"));
        assert_eq!(ts.account.as_deref(), Some("acc"));
    }

    fn expired(refresh: &str) -> TokenSet {
        TokenSet {
            access: "old".into(),
            refresh: Some(refresh.into()),
            expires_at: 1,
            account: None,
            client_id: None,
            obtained_at: None,
        }
    }

    #[tokio::test]
    async fn concurrent_callers_refresh_once() {
        let store = Arc::new(MemoryStore::default());
        let tm = Arc::new(TokenManager::new(store.clone()));
        tm.save("p", &expired("r1")).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let mut handles = vec![];
        for _ in 0..8 {
            let tm = tm.clone();
            let calls = calls.clone();
            handles.push(tokio::spawn(async move {
                tm.valid(
                    "p",
                    |_| 60_000,
                    |old| async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        assert_eq!(old.refresh.as_deref(), Some("r1"));
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                        Ok(TokenSet {
                            access: "new".into(),
                            refresh: Some("r2".into()),
                            expires_at: now_ms() + 3_600_000,
                            account: None,
                            client_id: None,
                            obtained_at: None,
                        })
                    },
                )
                .await
                .unwrap()
                .access
            }));
        }
        for h in handles {
            assert_eq!(h.await.unwrap(), "new");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            tm.load("p").unwrap().unwrap().refresh.as_deref(),
            Some("r2")
        );
    }
}
