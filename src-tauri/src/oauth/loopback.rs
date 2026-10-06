//! One-shot loopback HTTP server for the OAuth redirect. Binds 127.0.0.1 (never `localhost`).

use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub const CALLBACK_PATH: &str = "/auth/callback";

const DONE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Signed in</title>\
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#1f1f1f;background:#f8fafd}\
main{text-align:center}h1{font-size:20px;font-weight:600}p{color:#5f6368}</style></head>\
<body><main><h1>You can close this window</h1><p>Return to the app to continue.</p></main></body></html>";

const FAIL_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sign-in failed</title>\
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#1f1f1f;background:#f8fafd}\
main{text-align:center}h1{font-size:20px;font-weight:600}p{color:#5f6368}</style></head>\
<body><main><h1>Sign-in didn't complete</h1><p>Return to the app and try again.</p></main></body></html>";

pub struct Loopback {
    listener: TcpListener,
    pub port: u16,
}

#[derive(Debug, Clone)]
pub struct Callback {
    pub code: String,
    pub params: HashMap<String, String>,
}

impl Loopback {
    pub async fn bind() -> AppResult<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        Ok(Self { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{}", self.port, CALLBACK_PATH)
    }

    /// Waits for `GET /auth/callback?...` with a matching `state`. Other paths get a 404 and the
    /// server keeps waiting (browsers also ask for /favicon.ico).
    pub async fn wait(self, expected_state: &str, timeout: Duration) -> AppResult<Callback> {
        let fut = async {
            loop {
                let (mut sock, _) = self.listener.accept().await?;
                let Some(target) = read_request_target(&mut sock).await else {
                    continue;
                };
                match parse_callback(&target, expected_state) {
                    Parsed::NotCallback => respond(&mut sock, 404, "Not found").await,
                    Parsed::Ok(cb) => {
                        respond(&mut sock, 200, DONE_PAGE).await;
                        return Ok(cb);
                    }
                    Parsed::Err(e) => {
                        respond(&mut sock, 400, FAIL_PAGE).await;
                        return Err(e);
                    }
                }
            }
        };
        tokio::time::timeout(timeout, fut)
            .await
            .map_err(|_| AppError::Other("Sign-in timed out. Try again.".into()))?
    }
}

async fn read_request_target(sock: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 2048];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(10), sock.read(&mut tmp)).await.ok()?.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16 * 1024 {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let line = text.lines().next()?;
    let mut parts = line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    parts.next().map(str::to_string)
}

async fn respond(sock: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        _ => "Bad Request",
    };
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.write_all(resp.as_bytes()).await;
    let _ = sock.shutdown().await;
}

#[derive(Debug)]
pub enum Parsed {
    NotCallback,
    Ok(Callback),
    Err(AppError),
}

/// Parses a request target like `/auth/callback?code=..&state=..`.
pub fn parse_callback(target: &str, expected_state: &str) -> Parsed {
    let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Parsed::NotCallback;
    };
    if url.path() != CALLBACK_PATH {
        return Parsed::NotCallback;
    }
    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Parsed::Err(AppError::Other("Sign-in response didn't match this request (state mismatch).".into()));
    }
    if let Some(err) = params.get("error") {
        let msg = if err == "access_denied" {
            "Sign-in was cancelled.".to_string()
        } else {
            let desc = params.get("error_description").cloned().unwrap_or_default();
            format!("Sign-in failed: {err} {desc}").trim().to_string()
        };
        return Parsed::Err(AppError::Other(msg));
    }
    match params.get("code") {
        Some(code) if !code.is_empty() => Parsed::Ok(Callback { code: code.clone(), params }),
        _ => Parsed::Err(AppError::Other("Sign-in response had no authorization code.".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_code_and_extra_params() {
        match parse_callback("/auth/callback?code=abc&state=s1&client_id=oaiapp_x", "s1") {
            Parsed::Ok(cb) => {
                assert_eq!(cb.code, "abc");
                assert_eq!(cb.params["client_id"], "oaiapp_x");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn rejects_state_mismatch_and_errors() {
        assert!(matches!(parse_callback("/auth/callback?code=a&state=bad", "s1"), Parsed::Err(_)));
        assert!(matches!(parse_callback("/auth/callback?error=access_denied&state=s1", "s1"), Parsed::Err(_)));
        assert!(matches!(parse_callback("/favicon.ico", "s1"), Parsed::NotCallback));
        assert!(matches!(parse_callback("/callback?code=a&state=s1", "s1"), Parsed::NotCallback));
    }

    #[tokio::test]
    async fn serves_callback_over_tcp() {
        let lb = Loopback::bind().await.unwrap();
        let uri = lb.redirect_uri();
        assert!(uri.starts_with("http://127.0.0.1:"));
        let task = tokio::spawn(async move { lb.wait("st", Duration::from_secs(5)).await });
        let client = reqwest::Client::new();
        let miss = client.get(uri.replace("/auth/callback", "/favicon.ico")).send().await.unwrap();
        assert_eq!(miss.status(), 404);
        let resp = client.get(format!("{uri}?code=c0de&state=st")).send().await.unwrap();
        assert_eq!(resp.status(), 200);
        assert!(resp.text().await.unwrap().contains("You can close this window"));
        assert_eq!(task.await.unwrap().unwrap().code, "c0de");
    }

    #[tokio::test]
    async fn times_out() {
        let lb = Loopback::bind().await.unwrap();
        assert!(lb.wait("s", Duration::from_millis(50)).await.is_err());
    }
}
