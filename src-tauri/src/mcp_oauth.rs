//! OAuth for remote MCP servers: protected-resource discovery (RFC 9728), authorization server
//! metadata (RFC 8414), dynamic client registration (RFC 7591) and PKCE with a loopback redirect.

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::oauth::pkce;
use crate::oauth::tokens::{now_ms, oauth_error_message, post_form, TokenSet};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuth {
    pub tokens: TokenSet,
    pub token_endpoint: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    pub resource: String,
}

pub fn auth_account(id: &str) -> String {
    format!("mcp-oauth:{id}")
}

pub fn client_secret_account(id: &str) -> String {
    format!("mcp-oauth-client:{id}")
}

#[derive(Debug, Clone, PartialEq)]
pub struct Discovered {
    pub authorize: String,
    pub token: String,
    pub register: Option<String>,
    pub scope: Option<String>,
    pub resource: String,
}

/// A quoted or bare parameter from a `WWW-Authenticate: Bearer ...` header.
pub fn auth_param(header: &str, name: &str) -> Option<String> {
    let lower = header.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(&format!("{name}=")) {
        let start = from + at;
        from = start + name.len() + 1;
        if start > 0 && !matches!(lower.as_bytes()[start - 1], b' ' | b',' | b'\t') {
            continue;
        }
        let rest = &header[from..];
        return Some(match rest.strip_prefix('"') {
            Some(q) => q[..q.find('"').unwrap_or(q.len())].to_string(),
            None => rest[..rest.find([',', ' ']).unwrap_or(rest.len())].to_string(),
        });
    }
    None
}

/// `https://host/.well-known/<suffix><path>` first, then the root variant.
fn well_known(base: &Url, suffix: &str) -> Vec<String> {
    let origin = base.origin().ascii_serialization();
    let path = base.path().trim_end_matches('/');
    let mut out = vec![];
    if !path.is_empty() {
        out.push(format!("{origin}/.well-known/{suffix}{path}"));
    }
    out.push(format!("{origin}/.well-known/{suffix}"));
    out
}

async fn get_json(http: &reqwest::Client, url: &str) -> Option<Value> {
    let res = http
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.json().await.ok()
}

fn https_or_local(url: &str) -> AppResult<Url> {
    let u = Url::parse(url)
        .map_err(|_| AppError::Other(format!("The sign-in server sent a bad address: {url}")))?;
    let local = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if u.scheme() == "https" || (u.scheme() == "http" && local) {
        Ok(u)
    } else {
        Err(AppError::Other(format!(
            "The sign-in server must use https: {url}"
        )))
    }
}

/// Finds where to sign in for `server_url`. `challenge` is the `WWW-Authenticate` header of a 401, if any.
pub async fn discover(
    http: &reqwest::Client,
    server_url: &str,
    challenge: Option<&str>,
) -> AppResult<Discovered> {
    let server = Url::parse(server_url)
        .map_err(|_| AppError::Invalid("Enter the server's full URL.".into()))?;
    let mut candidates = challenge
        .and_then(|c| auth_param(c, "resource_metadata"))
        .into_iter()
        .collect::<Vec<_>>();
    candidates.extend(well_known(&server, "oauth-protected-resource"));
    let mut prm = None;
    for url in candidates {
        if let Some(v) = get_json(http, &url).await {
            prm = Some(v);
            break;
        }
    }
    let issuer = prm
        .as_ref()
        .and_then(|p| {
            p.get("authorization_servers")?
                .as_array()?
                .first()?
                .as_str()
                .map(str::to_string)
        })
        .unwrap_or_else(|| server.origin().ascii_serialization());
    let issuer = https_or_local(&issuer)?;
    let mut meta = None;
    let mut urls = well_known(&issuer, "oauth-authorization-server");
    urls.extend(well_known(&issuer, "openid-configuration"));
    let trimmed = issuer.as_str().trim_end_matches('/');
    urls.push(format!("{trimmed}/.well-known/openid-configuration"));
    for url in urls {
        if let Some(v) = get_json(http, &url).await {
            meta = Some(v);
            break;
        }
    }
    let origin = issuer.origin().ascii_serialization();
    let field = |k: &str, default: &str| -> String {
        meta.as_ref()
            .and_then(|m| m.get(k)?.as_str().map(str::to_string))
            .unwrap_or_else(|| format!("{origin}{default}"))
    };
    let authorize = field("authorization_endpoint", "/authorize");
    let token = field("token_endpoint", "/token");
    https_or_local(&authorize)?;
    https_or_local(&token)?;
    let register = match &meta {
        Some(m) => m
            .get("registration_endpoint")
            .and_then(Value::as_str)
            .map(str::to_string),
        None => Some(format!("{origin}/register")),
    };
    let scope = challenge.and_then(|c| auth_param(c, "scope")).or_else(|| {
        let list = prm.as_ref()?.get("scopes_supported")?.as_array()?;
        let joined = list
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        Some(joined).filter(|s| !s.is_empty())
    });
    let resource = prm
        .as_ref()
        .and_then(|p| p.get("resource")?.as_str().map(str::to_string))
        .unwrap_or_else(|| {
            let mut u = server.clone();
            u.set_fragment(None);
            u.to_string()
        });
    Ok(Discovered {
        authorize,
        token,
        register,
        scope,
        resource,
    })
}

/// Registers Ponder as a public client for `redirect_uri`. Returns (client_id, client_secret).
pub async fn register(
    http: &reqwest::Client,
    endpoint: &str,
    redirect_uri: &str,
) -> AppResult<(String, Option<String>)> {
    https_or_local(endpoint)?;
    let body = json!({
        "client_name": "Ponder",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    let res = http
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(oauth_error_message(0, &e.to_string())))?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(AppError::Other(oauth_error_message(status, &text)));
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| {
        AppError::Other("The sign-in server sent an unreadable registration.".into())
    })?;
    let id = v
        .get("client_id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Other("The sign-in server didn't return a client id.".into()))?;
    Ok((
        id.to_string(),
        v.get("client_secret")
            .and_then(Value::as_str)
            .map(str::to_string),
    ))
}

pub fn authorize_url(
    d: &Discovered,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    verifier: &str,
) -> AppResult<String> {
    let mut url = Url::parse(&d.authorize)
        .map_err(|_| AppError::Other("The sign-in server sent a bad address.".into()))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", client_id);
        q.append_pair("redirect_uri", redirect_uri);
        q.append_pair("state", state);
        q.append_pair("code_challenge", &pkce::challenge(verifier));
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("resource", &d.resource);
        if let Some(scope) = &d.scope {
            q.append_pair("scope", scope);
        }
    }
    Ok(url.into())
}

pub async fn exchange(
    http: &reqwest::Client,
    d: &Discovered,
    client: (&str, Option<&str>),
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> AppResult<McpAuth> {
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
        ("client_id", client.0),
        ("resource", d.resource.as_str()),
    ];
    if let Some(secret) = client.1 {
        form.push(("client_secret", secret));
    }
    let v = post_form(http, &d.token, &form)
        .await
        .map_err(|(s, b)| AppError::Other(oauth_error_message(s, &b)))?;
    let mut tokens = TokenSet::from_response(&v, now_ms(), None)?;
    tokens.client_id = Some(client.0.to_string());
    Ok(McpAuth {
        tokens,
        token_endpoint: d.token.clone(),
        client_secret: client.1.map(str::to_string),
        resource: d.resource.clone(),
    })
}

pub async fn refresh(http: &reqwest::Client, auth: &McpAuth) -> AppResult<McpAuth> {
    let refresh = auth.tokens.refresh.as_deref().ok_or_else(|| {
        AppError::Other("Your sign-in to this MCP server expired. Sign in again.".into())
    })?;
    let client_id = auth.tokens.client_id.as_deref().unwrap_or_default();
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh),
        ("client_id", client_id),
        ("resource", auth.resource.as_str()),
    ];
    if let Some(secret) = &auth.client_secret {
        form.push(("client_secret", secret));
    }
    let v = post_form(http, &auth.token_endpoint, &form)
        .await
        .map_err(|(s, b)| {
            AppError::Other(format!(
                "Your sign-in to this MCP server expired. Sign in again. ({})",
                oauth_error_message(s, &b)
            ))
        })?;
    let tokens = TokenSet::from_response(&v, now_ms(), Some(&auth.tokens))?;
    Ok(McpAuth {
        tokens,
        ..auth.clone()
    })
}

pub fn new_verifier() -> (String, String) {
    (pkce::verifier(), pkce::random_token(24))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    type Log = Arc<Mutex<Vec<(String, String)>>>;

    /// Serves the protected-resource and auth-server metadata, registration and the token endpoint.
    async fn fake_auth_server() -> (String, Log) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let log: Log = Arc::default();
        let (b, l) = (base.clone(), log.clone());
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let (base, log) = (b.clone(), l.clone());
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (line, body) = loop {
                        let n = sock.read(&mut chunk).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                        let text = String::from_utf8_lossy(&buf).to_string();
                        let Some(end) = text.find("\r\n\r\n") else {
                            continue;
                        };
                        let head = text[..end].to_lowercase();
                        let len: usize = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .map_or(0, |v| v.trim().parse().unwrap());
                        if buf.len() >= end + 4 + len {
                            break (
                                text.lines().next().unwrap().to_string(),
                                text[end + 4..end + 4 + len].to_string(),
                            );
                        }
                    };
                    let path = line.split(' ').nth(1).unwrap().to_string();
                    log.lock().unwrap().push((path.clone(), body.clone()));
                    let (status, out) = match path.as_str() {
                        "/.well-known/oauth-protected-resource/mcp" => (
                            "200 OK",
                            json!({ "resource": format!("{base}/mcp"), "authorization_servers": [format!("{base}/auth")], "scopes_supported": ["mcp"] }),
                        ),
                        "/.well-known/oauth-authorization-server/auth" => (
                            "200 OK",
                            json!({ "issuer": format!("{base}/auth"), "authorization_endpoint": format!("{base}/auth/go"), "token_endpoint": format!("{base}/auth/token"), "registration_endpoint": format!("{base}/auth/reg") }),
                        ),
                        "/auth/reg" => ("201 Created", json!({ "client_id": "c1" })),
                        "/auth/token" if body.contains("grant_type=authorization_code") => (
                            "200 OK",
                            json!({ "access_token": "a1", "refresh_token": "r1", "expires_in": 60 }),
                        ),
                        "/auth/token" => (
                            "200 OK",
                            json!({ "access_token": "a2", "expires_in": 3600 }),
                        ),
                        _ => ("404 Not Found", json!({})),
                    };
                    let out = out.to_string();
                    let resp = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{out}", out.len());
                    sock.write_all(resp.as_bytes()).await.unwrap();
                });
            }
        });
        (base, log)
    }

    #[tokio::test]
    async fn signs_in_and_refreshes() {
        let (base, log) = fake_auth_server().await;
        let http = reqwest::Client::new();
        let d = discover(&http, &format!("{base}/mcp"), None).await.unwrap();
        assert_eq!(d.authorize, format!("{base}/auth/go"));
        assert_eq!(d.scope.as_deref(), Some("mcp"));
        assert_eq!(d.resource, format!("{base}/mcp"));
        let (id, secret) = register(
            &http,
            d.register.as_deref().unwrap(),
            "http://127.0.0.1:1/auth/callback",
        )
        .await
        .unwrap();
        assert_eq!((id.as_str(), secret), ("c1", None));
        let auth = exchange(
            &http,
            &d,
            (&id, None),
            "code",
            "verifier",
            "http://127.0.0.1:1/auth/callback",
        )
        .await
        .unwrap();
        assert_eq!(
            (auth.tokens.access.as_str(), auth.tokens.refresh.as_deref()),
            ("a1", Some("r1"))
        );
        let fresh = refresh(&http, &auth).await.unwrap();
        assert_eq!(
            (
                fresh.tokens.access.as_str(),
                fresh.tokens.refresh.as_deref()
            ),
            ("a2", Some("r1"))
        );
        let token_calls: Vec<String> = log
            .lock()
            .unwrap()
            .iter()
            .filter(|(p, _)| p == "/auth/token")
            .map(|(_, b)| b.clone())
            .collect();
        assert!(token_calls
            .iter()
            .all(|b| b.contains("resource=") && b.contains("client_id=c1")));
    }

    #[test]
    fn reads_challenge_params() {
        let h = r#"Bearer error="invalid_token", resource_metadata="https://a.example/.well-known/oauth-protected-resource/mcp", scope=read"#;
        assert_eq!(
            auth_param(h, "resource_metadata").as_deref(),
            Some("https://a.example/.well-known/oauth-protected-resource/mcp")
        );
        assert_eq!(auth_param(h, "scope").as_deref(), Some("read"));
        assert_eq!(auth_param(h, "error").as_deref(), Some("invalid_token"));
        assert_eq!(auth_param(r#"Bearer xscope="no""#, "scope"), None);
    }

    #[test]
    fn builds_well_known_urls() {
        let u = Url::parse("https://a.example/tenant/mcp/").unwrap();
        assert_eq!(
            well_known(&u, "oauth-protected-resource"),
            [
                "https://a.example/.well-known/oauth-protected-resource/tenant/mcp",
                "https://a.example/.well-known/oauth-protected-resource"
            ]
        );
    }

    #[test]
    fn insists_on_https() {
        assert!(https_or_local("http://evil.example/token").is_err());
        assert!(https_or_local("http://127.0.0.1:9/token").is_ok());
        assert!(https_or_local("https://a.example/token").is_ok());
    }

    #[test]
    fn builds_the_authorize_url() {
        let d = Discovered {
            authorize: "https://a.example/authorize".into(),
            token: "https://a.example/token".into(),
            register: None,
            scope: Some("read write".into()),
            resource: "https://a.example/mcp".into(),
        };
        let url = Url::parse(
            &authorize_url(&d, "cid", "http://127.0.0.1:5/auth/callback", "st", "v").unwrap(),
        )
        .unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "cid");
        assert_eq!(q["resource"], "https://a.example/mcp");
        assert_eq!(q["scope"], "read write");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], pkce::challenge("v"));
    }
}
