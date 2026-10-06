//! RFC 8628 device authorization grant: token polling.

use serde_json::Value;
use std::time::{Duration, Instant};

pub const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Debug, Clone)]
pub struct PollConfig {
    pub interval: Duration,
    /// Added to the interval on every `slow_down` (RFC 8628 §3.5: 5 seconds).
    pub slow_down_step: Duration,
    pub expires_in: Duration,
}

#[derive(Debug, PartialEq)]
pub enum DeviceError {
    Denied,
    Expired,
    /// HTTP 403 without a standard OAuth error body
    Forbidden(String),
    Other(String),
}

#[derive(Debug, PartialEq)]
pub enum PollStep {
    Pending,
    SlowDown,
    Done(Value),
    Fail(DeviceError),
}

pub fn classify(status: u16, body: &str) -> PollStep {
    let json: Option<Value> = serde_json::from_str(body).ok();
    if (200..300).contains(&status) {
        return match json {
            Some(v) if v.get("access_token").and_then(Value::as_str).is_some_and(|s| !s.is_empty()) => PollStep::Done(v),
            _ => PollStep::Fail(DeviceError::Other("Token response had no access token".into())),
        };
    }
    let code = json.as_ref().and_then(|v| v.get("error")).and_then(Value::as_str).unwrap_or("");
    match code {
        "authorization_pending" => PollStep::Pending,
        "slow_down" => PollStep::SlowDown,
        "expired_token" => PollStep::Fail(DeviceError::Expired),
        "access_denied" | "authorization_denied" => PollStep::Fail(DeviceError::Denied),
        _ if status == 403 => PollStep::Fail(DeviceError::Forbidden(body.chars().take(300).collect())),
        "" => PollStep::Fail(DeviceError::Other(format!("HTTP {status}: {}", body.chars().take(300).collect::<String>()))),
        other => {
            let desc = json
                .as_ref()
                .and_then(|v| v.get("error_description"))
                .and_then(Value::as_str)
                .unwrap_or("");
            PollStep::Fail(DeviceError::Other(format!("{other} {desc}").trim().to_string()))
        }
    }
}

/// Polls the token endpoint until the user approves, denies, or the code expires.
pub async fn poll(
    http: &reqwest::Client,
    token_endpoint: &str,
    form: &[(&str, &str)],
    cfg: PollConfig,
) -> Result<Value, DeviceError> {
    let deadline = Instant::now() + cfg.expires_in;
    let mut interval = cfg.interval;
    loop {
        if Instant::now() + interval > deadline {
            return Err(DeviceError::Expired);
        }
        tokio::time::sleep(interval).await;
        let resp = http
            .post(token_endpoint)
            .header("Accept", "application/json")
            .form(form)
            .send()
            .await
            .map_err(|e| DeviceError::Other(e.to_string()))?;
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        match classify(status, &body) {
            PollStep::Pending => {}
            PollStep::SlowDown => interval += cfg.slow_down_step,
            PollStep::Done(v) => return Ok(v),
            PollStep::Fail(e) => return Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_rfc_errors() {
        assert_eq!(classify(400, r#"{"error":"authorization_pending"}"#), PollStep::Pending);
        assert_eq!(classify(400, r#"{"error":"slow_down"}"#), PollStep::SlowDown);
        assert_eq!(classify(400, r#"{"error":"expired_token"}"#), PollStep::Fail(DeviceError::Expired));
        assert_eq!(classify(400, r#"{"error":"access_denied"}"#), PollStep::Fail(DeviceError::Denied));
        assert!(matches!(classify(403, "nope"), PollStep::Fail(DeviceError::Forbidden(_))));
        assert!(matches!(classify(200, r#"{"access_token":"a"}"#), PollStep::Done(_)));
        assert!(matches!(classify(200, r#"{}"#), PollStep::Fail(DeviceError::Other(_))));
    }
}
