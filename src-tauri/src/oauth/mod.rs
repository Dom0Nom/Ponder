//! OAuth: PKCE + loopback, device code, rotating refresh. ChatGPT and xAI per docs/OAUTH.md.

pub mod chatgpt;
pub mod device;
pub mod loopback;
pub mod pkce;
pub mod tokens;
pub mod xai;

use crate::error::{invalid, AppResult};
use crate::secrets::SecretStore;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokens::{TokenManager, TokenSet};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    pub provider_id: String,
    /// signedOut | pending | signedIn | error
    pub state: &'static str,
    pub account: Option<String>,
    pub error: Option<String>,
    pub expires_at: Option<i64>,
}

pub struct OAuth {
    pub tokens: TokenManager,
    pub http: reqwest::Client,
    pub chatgpt: chatgpt::Endpoints,
    pub xai: xai::Endpoints,
    transient: Mutex<HashMap<String, OAuthStatus>>,
    flows: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

impl OAuth {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self {
            tokens: TokenManager::new(store),
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("http client"),
            chatgpt: chatgpt::Endpoints::default(),
            xai: xai::Endpoints::default(),
            transient: Mutex::new(HashMap::new()),
            flows: Mutex::new(HashMap::new()),
        }
    }

    /// A valid access token for an OAuth provider, refreshed (and persisted) when needed.
    pub async fn access_token(&self, provider_type: &str, provider_id: &str) -> AppResult<TokenSet> {
        let http = &self.http;
        let result = match provider_type {
            "chatgpt-oauth" => {
                let ep = &self.chatgpt;
                self.tokens
                    .valid(provider_id, |_| chatgpt::REFRESH_SKEW_MS, |old| async move { chatgpt::refresh(http, ep, &old).await })
                    .await
            }
            "xai-oauth" => {
                let ep = &self.xai;
                self.tokens
                    .valid(provider_id, xai::refresh_skew_ms, |old| async move { xai::refresh(http, ep, &old).await })
                    .await
            }
            other => return Err(invalid(format!("{other} isn't an OAuth provider"))),
        };
        match &result {
            Err(e) => self.set_transient(self.error_status(provider_id, e.to_string())),
            Ok(_) => {
                let mut t = self.transient.lock().unwrap();
                if t.get(provider_id).is_some_and(|s| s.state == "error") {
                    t.remove(provider_id);
                }
            }
        }
        result
    }

    pub fn status(&self, provider_id: &str) -> AppResult<OAuthStatus> {
        if let Some(s) = self.transient.lock().unwrap().get(provider_id) {
            return Ok(s.clone());
        }
        Ok(match self.tokens.load(provider_id)? {
            Some(ts) => OAuthStatus {
                provider_id: provider_id.into(),
                state: "signedIn",
                account: ts.account,
                error: None,
                expires_at: Some(ts.expires_at),
            },
            None => OAuthStatus { provider_id: provider_id.into(), state: "signedOut", account: None, error: None, expires_at: None },
        })
    }

    pub fn pending_status(&self, provider_id: &str) -> OAuthStatus {
        OAuthStatus { provider_id: provider_id.into(), state: "pending", account: None, error: None, expires_at: None }
    }

    pub fn error_status(&self, provider_id: &str, msg: String) -> OAuthStatus {
        OAuthStatus { provider_id: provider_id.into(), state: "error", account: None, error: Some(msg), expires_at: None }
    }

    pub fn set_transient(&self, s: OAuthStatus) {
        self.transient.lock().unwrap().insert(s.provider_id.clone(), s);
    }

    pub fn clear_transient(&self, provider_id: &str) {
        self.transient.lock().unwrap().remove(provider_id);
    }

    /// Registers a running sign-in flow, cancelling any earlier one for the same provider.
    pub fn track_flow(&self, provider_id: &str, handle: tokio::task::AbortHandle) {
        if let Some(old) = self.flows.lock().unwrap().insert(provider_id.into(), handle) {
            old.abort();
        }
    }

    pub fn cancel_flow(&self, provider_id: &str) {
        if let Some(h) = self.flows.lock().unwrap().remove(provider_id) {
            h.abort();
        }
    }

    pub fn sign_out(&self, provider_id: &str) -> AppResult<()> {
        self.cancel_flow(provider_id);
        self.clear_transient(provider_id);
        self.tokens.clear(provider_id)
    }
}
