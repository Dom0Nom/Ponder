//! Streaming HTTP proxy for AI calls. Injects provider secrets; the webview never sees them.

use crate::db::models::Provider;
use crate::error::{invalid, AppError, AppResult};
use crate::oauth::OAuth;
use crate::secrets::SecretStore;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequest {
    pub id: String,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ProxyEvent {
    Head {
        status: u16,
        headers: BTreeMap<String, String>,
    },
    Chunk {
        data: String,
    },
    End,
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedPage {
    pub status: u16,
    pub url: String,
    pub content_type: Option<String>,
    pub body: String,
}

/// A request ready to send: auth already decided.
#[derive(Debug, Clone)]
pub struct Prepared {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    /// Shown instead of the response when the server answers 403 (xAI plan gate).
    pub forbidden_message: Option<String>,
}

// ---------- auth injection rules ----------

const AUTH_HEADERS: &[&str] = &[
    "authorization",
    "x-api-key",
    "x-goog-api-key",
    "x-subscription-token",
    "xi-api-key",
];

/// Web search and speech APIs whose keys live in the secret store under `search:<engine>` / `tts:<service>`.
pub const SEARCH_ENGINES: &[(&str, &str)] = &[
    ("search:brave", "Brave Search"),
    ("search:tavily", "Tavily"),
    ("search:exa", "Exa"),
    ("tts:elevenlabs", "ElevenLabs"),
    ("tts:fish", "Fish Audio"),
];

/// A stand-in provider for a search engine, so its key is injected like a provider's.
pub fn search_provider(id: &str) -> Option<Provider> {
    let (_, name) = SEARCH_ENGINES.iter().find(|(i, _)| *i == id)?;
    Some(Provider {
        id: id.into(),
        provider_type: id.into(),
        kind: "apiKey".into(),
        name: (*name).into(),
        base_url: None,
        config: serde_json::json!({}),
        created_at: 0,
    })
}

/// The official API base for provider types that have one.
pub fn official_base(provider_type: &str) -> Option<&'static str> {
    Some(match provider_type {
        "anthropic" => "https://api.anthropic.com",
        "openai" => "https://api.openai.com",
        "google" => "https://generativelanguage.googleapis.com",
        "openrouter" => "https://openrouter.ai/api",
        "xai" => "https://api.x.ai",
        "groq" => "https://api.groq.com",
        "mistral" => "https://api.mistral.ai",
        "deepseek" => "https://api.deepseek.com",
        "chatgpt-oauth" => "https://api.openai.com/v1",
        "xai-oauth" => "https://api.x.ai/v1",
        "search:brave" => "https://api.search.brave.com",
        "search:tavily" => "https://api.tavily.com",
        "search:exa" => "https://api.exa.ai",
        "tts:elevenlabs" => "https://api.elevenlabs.io",
        "tts:fish" => "https://api.fish.audio",
        _ => return None,
    })
}

/// True when `target` has the same scheme, host and port as `base` and its path is `base`'s path
/// or below it (segment boundary, so `/v1` doesn't cover `/v10`).
pub fn url_under(base: &str, target: &str) -> bool {
    let (Ok(b), Ok(t)) = (url::Url::parse(base.trim()), url::Url::parse(target)) else {
        return false;
    };
    if !matches!(b.scheme(), "http" | "https") || b.scheme() != t.scheme() {
        return false;
    }
    if !t.username().is_empty() || t.password().is_some() {
        return false;
    }
    let (Some(bh), Some(th)) = (b.host_str(), t.host_str()) else {
        return false;
    };
    if !bh.eq_ignore_ascii_case(th) || b.port_or_known_default() != t.port_or_known_default() {
        return false;
    }
    let bp = b.path().trim_end_matches('/');
    let tp = t.path();
    bp.is_empty() || tp == bp || tp.starts_with(&format!("{bp}/"))
}

pub fn may_inject(provider_type: &str, base_url: Option<&str>, target: &str) -> bool {
    base_url.is_some_and(|b| !b.trim().is_empty() && url_under(b, target))
        || official_base(provider_type).is_some_and(|b| url_under(b, target))
}

pub fn strip_auth(headers: &HashMap<String, String>) -> Vec<(String, String)> {
    headers
        .iter()
        .filter(|(k, _)| !AUTH_HEADERS.contains(&k.to_ascii_lowercase().as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

pub fn auth_header(provider_type: &str, secret: &str) -> (String, String) {
    match provider_type {
        "anthropic" => ("x-api-key".into(), secret.into()),
        "google" => ("x-goog-api-key".into(), secret.into()),
        "search:brave" => ("X-Subscription-Token".into(), secret.into()),
        "search:exa" => ("x-api-key".into(), secret.into()),
        "tts:elevenlabs" => ("xi-api-key".into(), secret.into()),
        _ => ("Authorization".into(), format!("Bearer {secret}")),
    }
}

fn is_oauth(provider_type: &str) -> bool {
    matches!(provider_type, "chatgpt-oauth" | "xai-oauth")
}

/// Strips auth headers coming from JS and injects the provider's credential when the URL belongs
/// to that provider. Without a provider, no auth is sent at all.
pub async fn prepare(
    req: &ProxyRequest,
    provider: Option<&Provider>,
    secrets: &dyn SecretStore,
    oauth: &OAuth,
) -> AppResult<Prepared> {
    let parsed = url::Url::parse(&req.url).map_err(|_| invalid("Invalid URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(invalid("Only http and https URLs are allowed"));
    }
    let mut headers = strip_auth(&req.headers);
    let mut forbidden_message = None;
    if let Some(p) = provider {
        let t = p.provider_type.as_str();
        if may_inject(t, p.base_url.as_deref(), &req.url) {
            if is_oauth(t) {
                let ts = oauth.access_token(t, &p.id).await?;
                headers.push(auth_header(t, &ts.access));
                if t == "xai-oauth" {
                    forbidden_message = Some(crate::oauth::xai::PLAN_ERROR.to_string());
                }
            } else if let Some(key) = secrets.get(&p.id)? {
                headers.push(auth_header(t, &key));
            } else if p.kind == "apiKey" {
                return Err(AppError::Other(format!(
                    "No API key saved for {}. Add one in Settings.",
                    p.name
                )));
            }
        }
    }
    Ok(Prepared {
        url: req.url.clone(),
        method: req.method.clone(),
        headers,
        body: req.body.clone(),
        forbidden_message,
    })
}

// ---------- streaming ----------

/// Incremental UTF-8 decoder that never splits a code point across chunks.
#[derive(Default)]
pub struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    return out;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap());
                    match e.error_len() {
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + bad);
                        }
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                    }
                }
            }
        }
    }

    pub fn finish(&mut self) -> String {
        let s = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        s
    }
}

pub fn stream_client() -> reqwest::Client {
    let same_host = reqwest::redirect::Policy::custom(|a| {
        let first = a
            .previous()
            .first()
            .and_then(|u| u.host_str().map(str::to_owned));
        if a.previous().len() > 5 || first.as_deref() != a.url().host_str() {
            a.stop()
        } else {
            a.follow()
        }
    });
    reqwest::Client::builder()
        .redirect(same_host)
        .connect_timeout(Duration::from_secs(20))
        .build()
        .expect("http client")
}

fn header_map(h: &reqwest::header::HeaderMap) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in h {
        let name = k.as_str().to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "content-length" | "content-encoding" | "transfer-encoding" | "set-cookie"
        ) {
            continue;
        }
        let val = String::from_utf8_lossy(v.as_bytes()).into_owned();
        out.entry(name)
            .and_modify(|e| {
                e.push_str(", ");
                e.push_str(&val);
            })
            .or_insert(val);
    }
    out
}

/// Sends the request and streams `head`, `chunk`…, then `end` (or `error`) to `emit`.
pub async fn run(
    http: &reqwest::Client,
    req: Prepared,
    mut cancel: oneshot::Receiver<()>,
    mut emit: impl FnMut(ProxyEvent),
) {
    let method = match reqwest::Method::from_bytes(req.method.to_ascii_uppercase().as_bytes()) {
        Ok(m) => m,
        Err(_) => {
            return emit(ProxyEvent::Error {
                message: format!("Invalid method {}", req.method),
            })
        }
    };
    let mut rb = http.request(method, &req.url);
    for (k, v) in &req.headers {
        rb = rb.header(k, v);
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let resp = tokio::select! {
        r = rb.send() => r,
        _ = &mut cancel => return emit(ProxyEvent::Error { message: "aborted".into() }),
    };
    let mut resp = match resp {
        Ok(r) => r,
        Err(e) => {
            return emit(ProxyEvent::Error {
                message: describe_reqwest(&e, &req.url),
            })
        }
    };
    let status = resp.status().as_u16();
    if status == 403 {
        if let Some(m) = req.forbidden_message {
            return emit(ProxyEvent::Error { message: m });
        }
    }
    let is_sse = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));
    emit(ProxyEvent::Head {
        status,
        headers: header_map(resp.headers()),
    });
    let mut dec = Utf8Decoder::default();
    let mut received = 0usize;
    let mut tail = String::new();
    loop {
        let next = tokio::select! {
            c = tokio::time::timeout(STREAM_IDLE_TIMEOUT, resp.chunk()) => c,
            _ = &mut cancel => return emit(ProxyEvent::Error { message: "aborted".into() }),
        };
        match next {
            Ok(Ok(Some(bytes))) => {
                received += bytes.len();
                let s = dec.push(&bytes);
                if !s.is_empty() {
                    if is_sse {
                        keep_tail(&mut tail, &s);
                    }
                    emit(ProxyEvent::Chunk { data: s });
                }
            }
            Ok(Ok(None)) => break,
            Ok(Err(e)) => {
                // Some servers drop the connection right after the final event instead of closing
                // the body cleanly; the answer is complete, so that isn't an error.
                if is_sse && sse_finished(&tail) {
                    log::info!("stream closed uncleanly after its final event ({received} bytes)");
                    break;
                }
                let host = host_of(&req.url);
                let message = if received > 0 {
                    format!(
                        "The connection to {host} closed before the answer finished ({})",
                        root_cause(&e)
                    )
                } else {
                    describe_reqwest(&e, &req.url)
                };
                log::warn!("stream broke after {received} bytes: {message}");
                return emit(ProxyEvent::Error { message });
            }
            Err(_) => {
                let host = host_of(&req.url);
                log::warn!(
                    "stream idle for {}s after {received} bytes",
                    STREAM_IDLE_TIMEOUT.as_secs()
                );
                return emit(ProxyEvent::Error {
                    message: format!(
                        "{host} stopped sending data for {} seconds",
                        STREAM_IDLE_TIMEOUT.as_secs()
                    ),
                });
            }
        }
    }
    let tail = dec.finish();
    if !tail.is_empty() {
        emit(ProxyEvent::Chunk { data: tail });
    }
    emit(ProxyEvent::End);
}

/// Sends a request and returns the whole body as bytes (audio). Non-2xx answers become errors with
/// the start of the server's message.
pub async fn fetch_bytes(http: &reqwest::Client, req: Prepared) -> AppResult<Vec<u8>> {
    let method = reqwest::Method::from_bytes(req.method.to_ascii_uppercase().as_bytes())
        .map_err(|_| invalid("Invalid method"))?;
    let mut rb = http.request(method, &req.url).timeout(BYTES_TIMEOUT);
    for (k, v) in &req.headers {
        rb = rb.header(k, v);
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let resp = rb
        .send()
        .await
        .map_err(|e| AppError::Other(describe_reqwest(&e, &req.url)))?;
    let status = resp.status().as_u16();
    if status == 403 {
        if let Some(m) = req.forbidden_message {
            return Err(AppError::Other(m));
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Other(describe_reqwest(&e, &req.url)))?;
    if !(200..300).contains(&status) {
        return Err(AppError::Other(http_error_message(
            status,
            &host_of(&req.url),
            &bytes,
        )));
    }
    Ok(bytes.to_vec())
}

const BYTES_TIMEOUT: Duration = Duration::from_secs(180);

/// "openrouter.ai answered 400: Voice not found" from a JSON `{error: {message}}`, `{message}`,
/// `{detail}` body or plain text.
pub fn http_error_message(status: u16, host: &str, body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    let detail = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| {
            let pick = |v: &serde_json::Value| v.as_str().map(str::to_string);
            pick(&v["error"]["message"])
                .or_else(|| pick(&v["error"]))
                .or_else(|| pick(&v["message"]))
                .or_else(|| pick(&v["detail"]))
                .or_else(|| pick(&v["detail"]["message"]))
        })
        .unwrap_or_else(|| text.trim().to_string());
    let detail: String = detail.chars().take(300).collect();
    if detail.is_empty() {
        format!("{host} answered {status}")
    } else {
        format!("{host} answered {status}: {detail}")
    }
}

/// Longest silence (no bytes, not even SSE keep-alive comments) before a stream counts as dead.
/// Reasoning models can think for minutes, but providers send keep-alives meanwhile.
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(300);

fn keep_tail(tail: &mut String, s: &str) {
    tail.push_str(s);
    if tail.len() > 4096 {
        let mut cut = tail.len() - 2048;
        while !tail.is_char_boundary(cut) {
            cut += 1;
        }
        tail.drain(..cut);
    }
}

/// True when the last complete SSE event is a provider's end-of-stream marker.
pub fn sse_finished(tail: &str) -> bool {
    let t = tail.replace("\r\n", "\n");
    let Some(end) = t.rfind("\n\n") else {
        return false;
    };
    let last = t[..end].rsplit("\n\n").next().unwrap_or("");
    last.contains("data: [DONE]")
        || last.contains("data:[DONE]")
        || last.contains("event: message_stop")
        || last.contains("\"type\":\"message_stop\"")
        || last.contains("\"type\":\"response.completed\"")
        || last.contains("\"finishReason\"")
}

fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default()
}

fn root_cause(e: &reqwest::Error) -> String {
    let mut msg = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(cause) = src {
        msg = cause.to_string();
        src = cause.source();
    }
    msg
}

fn describe_reqwest(e: &reqwest::Error, url: &str) -> String {
    let host = host_of(url);
    if e.is_connect() {
        format!("Couldn't connect to {host}. Is the server running and reachable?")
    } else if e.is_timeout() {
        format!("{host} took too long to respond")
    } else {
        let mut msg = format!("Request to {host} failed: {e}");
        let mut src = std::error::Error::source(e);
        while let Some(cause) = src {
            msg.push_str(&format!(": {cause}"));
            src = cause.source();
        }
        msg
    }
}

/// In-flight requests by id, for `http_abort`.
#[derive(Default)]
pub struct Inflight(Mutex<HashMap<String, oneshot::Sender<()>>>);

impl Inflight {
    pub fn register(&self, id: &str) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        self.0.lock().unwrap().insert(id.to_string(), tx);
        rx
    }
    pub fn abort(&self, id: &str) -> bool {
        match self.0.lock().unwrap().remove(id) {
            Some(tx) => tx.send(()).is_ok(),
            None => false,
        }
    }
    pub fn done(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}

// ---------- plain page fetch (web import, research) ----------

pub const PAGE_LIMIT: usize = 15 * 1024 * 1024;
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

pub fn page_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client")
}

pub async fn get_text(
    http: &reqwest::Client,
    url: &str,
    headers: Option<HashMap<String, String>>,
) -> AppResult<FetchedPage> {
    let parsed =
        url::Url::parse(url).map_err(|_| invalid("That doesn't look like a web address"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(invalid("Only http and https pages can be fetched"));
    }
    let mut rb = http.get(parsed).header(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    );
    if let Some(h) = &headers {
        for (k, v) in strip_auth(h) {
            rb = rb.header(k, v);
        }
    }
    let mut resp = rb
        .send()
        .await
        .map_err(|e| AppError::Other(describe_reqwest(&e, url)))?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::Other(describe_reqwest(&e, url)))?
    {
        if buf.len() + chunk.len() > PAGE_LIMIT {
            return Err(AppError::Other("The page is larger than 15 MB".into()));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(FetchedPage {
        status,
        url: final_url,
        content_type,
        body: String::from_utf8_lossy(&buf).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;
    use std::sync::Arc;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn provider(t: &str, kind: &str, base: Option<&str>) -> Provider {
        Provider {
            id: "p1".into(),
            provider_type: t.into(),
            kind: kind.into(),
            name: "P".into(),
            base_url: base.map(str::to_string),
            config: serde_json::json!({}),
            created_at: 0,
        }
    }

    fn req(url: &str, headers: &[(&str, &str)]) -> ProxyRequest {
        ProxyRequest {
            id: "r".into(),
            url: url.into(),
            method: "POST".into(),
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            body: Some("{}".into()),
            provider_id: Some("p1".into()),
        }
    }

    fn find<'a>(h: &'a [(String, String)], name: &str) -> Option<&'a str> {
        h.iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    #[test]
    fn url_matching() {
        assert!(url_under(
            "http://localhost:1234/v1",
            "http://localhost:1234/v1/chat/completions"
        ));
        assert!(url_under(
            "http://LOCALHOST:1234/v1/",
            "http://localhost:1234/v1/models"
        ));
        assert!(url_under(
            "https://api.openai.com",
            "https://api.openai.com:443/v1/responses"
        ));
        assert!(!url_under(
            "http://localhost:1234/v1",
            "http://localhost:1234/v10/models"
        ));
        assert!(!url_under(
            "http://localhost:1234/v1",
            "http://localhost:1235/v1/models"
        ));
        assert!(!url_under(
            "http://localhost:1234/v1",
            "https://localhost:1234/v1/models"
        ));
        assert!(!url_under(
            "https://api.openai.com",
            "https://api.openai.com.evil.com/v1"
        ));
        assert!(!url_under(
            "https://api.openai.com",
            "https://user@api.openai.com/v1"
        ));
        assert!(!url_under("http://a.com/v1", "http://b.com/v1/x"));
        assert!(!url_under("not a url", "http://b.com/v1/x"));
    }

    #[test]
    fn injection_scope() {
        assert!(may_inject(
            "openai",
            None,
            "https://api.openai.com/v1/chat/completions"
        ));
        assert!(!may_inject(
            "openai",
            None,
            "https://example.com/v1/chat/completions"
        ));
        assert!(may_inject(
            "openai-compatible",
            Some("https://my.host/api"),
            "https://my.host/api/chat"
        ));
        assert!(!may_inject(
            "openai-compatible",
            None,
            "https://my.host/api/chat"
        ));
        assert!(!may_inject(
            "anthropic",
            None,
            "https://api.openai.com/v1/x"
        ));
        assert!(may_inject(
            "xai-oauth",
            None,
            "https://api.x.ai/v1/responses"
        ));
        assert!(!may_inject(
            "xai-oauth",
            None,
            "https://api.x.ai/v2/responses"
        ));
        assert!(may_inject(
            "google",
            None,
            "https://generativelanguage.googleapis.com/v1beta/models"
        ));
    }

    #[test]
    fn header_shapes() {
        assert_eq!(
            auth_header("anthropic", "k"),
            ("x-api-key".into(), "k".into())
        );
        assert_eq!(
            auth_header("google", "k"),
            ("x-goog-api-key".into(), "k".into())
        );
        assert_eq!(
            auth_header("groq", "k"),
            ("Authorization".into(), "Bearer k".into())
        );
        assert_eq!(
            auth_header("search:brave", "k"),
            ("X-Subscription-Token".into(), "k".into())
        );
        assert_eq!(
            auth_header("search:exa", "k"),
            ("x-api-key".into(), "k".into())
        );
        assert_eq!(
            auth_header("search:tavily", "k"),
            ("Authorization".into(), "Bearer k".into())
        );
    }

    #[test]
    fn search_injection_scope() {
        assert!(may_inject(
            "search:brave",
            None,
            "https://api.search.brave.com/res/v1/web/search?q=a"
        ));
        assert!(!may_inject(
            "search:brave",
            None,
            "https://api.tavily.com/search"
        ));
        assert!(!may_inject(
            "search:brave",
            None,
            "https://api.search.brave.com.evil.com/res/v1"
        ));
        assert!(!may_inject(
            "search:brave",
            None,
            "http://api.search.brave.com/res/v1"
        ));
        assert!(may_inject(
            "search:tavily",
            None,
            "https://api.tavily.com/search"
        ));
        assert!(!may_inject(
            "search:tavily",
            None,
            "https://example.com/search"
        ));
        assert!(may_inject("search:exa", None, "https://api.exa.ai/search"));
        assert!(!may_inject(
            "search:exa",
            None,
            "https://api.exa.ai.evil.com/search"
        ));
        assert!(search_provider("search:exa").is_some());
        assert!(search_provider("search:other").is_none());
        assert!(search_provider("p1").is_none());
    }

    #[tokio::test]
    async fn speech_keys_are_injected_only_for_their_service() {
        let store = MemoryStore::default();
        store.set("tts:elevenlabs", "el-real").unwrap();
        store.set("tts:fish", "fish-real").unwrap();
        let oauth = OAuth::new(Arc::new(MemoryStore::default()));
        let el = search_provider("tts:elevenlabs").unwrap();
        let r = req(
            "https://api.elevenlabs.io/v1/text-to-speech/abc",
            &[("xi-api-key", "dummy")],
        );
        let out = prepare(&r, Some(&el), &store, &oauth).await.unwrap();
        assert_eq!(find(&out.headers, "xi-api-key"), Some("el-real"));
        let out = prepare(
            &req("https://api.fish.audio/v1/tts", &[("xi-api-key", "dummy")]),
            Some(&el),
            &store,
            &oauth,
        )
        .await
        .unwrap();
        assert!(out.headers.is_empty());
        let fish = search_provider("tts:fish").unwrap();
        let out = prepare(
            &req("https://api.fish.audio/v1/tts", &[]),
            Some(&fish),
            &store,
            &oauth,
        )
        .await
        .unwrap();
        assert_eq!(
            find(&out.headers, "authorization"),
            Some("Bearer fish-real")
        );
    }

    #[test]
    fn http_errors_name_the_host_and_the_servers_message() {
        assert_eq!(
            http_error_message(
                400,
                "openrouter.ai",
                br#"{"error":{"message":"Voice not found","code":400}}"#
            ),
            "openrouter.ai answered 400: Voice not found"
        );
        assert_eq!(
            http_error_message(
                401,
                "api.elevenlabs.io",
                br#"{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}"#
            ),
            "api.elevenlabs.io answered 401: Invalid API key"
        );
        assert_eq!(
            http_error_message(500, "api.fish.audio", b"  upstream down "),
            "api.fish.audio answered 500: upstream down"
        );
        assert_eq!(http_error_message(502, "x.ai", b""), "x.ai answered 502");
        assert_eq!(
            http_error_message(400, "h", "é".repeat(400).as_bytes())
                .chars()
                .count(),
            "h answered 400: ".len() + 300
        );
    }

    #[tokio::test]
    async fn search_keys_are_injected_in_rust_only() {
        let store = MemoryStore::default();
        store.set("search:brave", "BSA-real").unwrap();
        store.set("search:tavily", "tvly-real").unwrap();
        let oauth = OAuth::new(Arc::new(MemoryStore::default()));
        let brave = search_provider("search:brave").unwrap();
        let mut r = req(
            "https://api.search.brave.com/res/v1/web/search?q=cells",
            &[
                ("X-Subscription-Token", "dummy"),
                ("authorization", "Bearer dummy"),
                ("accept", "application/json"),
            ],
        );
        r.provider_id = Some("search:brave".into());
        let out = prepare(&r, Some(&brave), &store, &oauth).await.unwrap();
        assert_eq!(find(&out.headers, "x-subscription-token"), Some("BSA-real"));
        assert_eq!(find(&out.headers, "authorization"), None);
        assert_eq!(find(&out.headers, "accept"), Some("application/json"));
        assert_eq!(
            out.headers
                .iter()
                .filter(|(k, _)| k.eq_ignore_ascii_case("x-subscription-token"))
                .count(),
            1
        );

        // other host: JS-supplied headers stripped, nothing injected
        let r = req(
            "https://evil.example/res/v1/web/search",
            &[
                ("X-Subscription-Token", "dummy"),
                ("Authorization", "Bearer dummy"),
            ],
        );
        let out = prepare(&r, Some(&brave), &store, &oauth).await.unwrap();
        assert!(out.headers.is_empty());

        // another engine's host does not get Brave's key
        let r = req("https://api.tavily.com/search", &[]);
        let out = prepare(&r, Some(&brave), &store, &oauth).await.unwrap();
        assert!(out.headers.is_empty());

        let tavily = search_provider("search:tavily").unwrap();
        let r = req(
            "https://api.tavily.com/search",
            &[("Authorization", "Bearer dummy")],
        );
        let out = prepare(&r, Some(&tavily), &store, &oauth).await.unwrap();
        assert_eq!(
            find(&out.headers, "authorization"),
            Some("Bearer tvly-real")
        );

        // no key saved: clear error
        let exa = search_provider("search:exa").unwrap();
        let e = prepare(
            &req("https://api.exa.ai/search", &[]),
            Some(&exa),
            &store,
            &oauth,
        )
        .await
        .unwrap_err();
        assert!(e.to_string().contains("No API key saved for Exa"));
    }

    #[tokio::test]
    async fn prepare_strips_and_injects() {
        let store = MemoryStore::default();
        store.set("p1", "sk-real").unwrap();
        let oauth = OAuth::new(Arc::new(MemoryStore::default()));
        let p = provider("anthropic", "apiKey", None);
        let r = req(
            "https://api.anthropic.com/v1/messages",
            &[
                ("x-api-key", "dummy"),
                ("Authorization", "Bearer dummy"),
                ("anthropic-version", "2023-06-01"),
                ("content-type", "application/json"),
            ],
        );
        let out = prepare(&r, Some(&p), &store, &oauth).await.unwrap();
        assert_eq!(find(&out.headers, "x-api-key"), Some("sk-real"));
        assert_eq!(find(&out.headers, "authorization"), None);
        assert_eq!(find(&out.headers, "anthropic-version"), Some("2023-06-01"));
        assert_eq!(
            out.headers
                .iter()
                .filter(|(k, _)| k.eq_ignore_ascii_case("x-api-key"))
                .count(),
            1
        );

        // foreign URL: stripped, nothing injected
        let r = req(
            "https://evil.example/v1/messages",
            &[("x-api-key", "dummy")],
        );
        let out = prepare(&r, Some(&p), &store, &oauth).await.unwrap();
        assert!(out
            .headers
            .iter()
            .all(|(k, _)| !k.eq_ignore_ascii_case("x-api-key")));

        // no provider: never auth
        let out = prepare(&r, None, &store, &oauth).await.unwrap();
        assert!(out.headers.is_empty());

        // local without key: no auth, no error
        let lm = provider("lmstudio", "local", Some("http://localhost:1234/v1"));
        let out = prepare(
            &req("http://localhost:1234/v1/models", &[]),
            Some(&lm),
            &MemoryStore::default(),
            &oauth,
        )
        .await
        .unwrap();
        assert!(out.headers.is_empty());

        // api-key provider without key: clear error
        let oa = provider("openai", "apiKey", None);
        let e = prepare(
            &req("https://api.openai.com/v1/models", &[]),
            Some(&oa),
            &MemoryStore::default(),
            &oauth,
        )
        .await
        .unwrap_err();
        assert!(e.to_string().contains("No API key"));

        // OAuth provider uses the stored access token
        let ostore = Arc::new(MemoryStore::default());
        let oauth = OAuth::new(ostore.clone());
        oauth
            .tokens
            .save(
                "p1",
                &crate::oauth::tokens::TokenSet {
                    access: "tok".into(),
                    refresh: Some("r".into()),
                    expires_at: crate::db::now_ms() + 3_600_000 * 5,
                    account: None,
                    client_id: Some("oaiapp_x".into()),
                    obtained_at: None,
                },
            )
            .unwrap();
        let cg = provider("chatgpt-oauth", "oauth", None);
        let out = prepare(
            &req(
                "https://api.openai.com/v1/responses",
                &[("authorization", "Bearer dummy")],
            ),
            Some(&cg),
            &store,
            &oauth,
        )
        .await
        .unwrap();
        assert_eq!(find(&out.headers, "authorization"), Some("Bearer tok"));
    }

    #[test]
    fn utf8_never_splits_code_points() {
        let text = "héllo → 世界 🎉 done";
        let bytes = text.as_bytes();
        for split in 0..=bytes.len() {
            let mut d = Utf8Decoder::default();
            let mut out = d.push(&bytes[..split]);
            out.push_str(&d.push(&bytes[split..]));
            out.push_str(&d.finish());
            assert_eq!(out, text, "split at {split}");
        }
        let mut d = Utf8Decoder::default();
        let mut out = String::new();
        for b in bytes {
            out.push_str(&d.push(std::slice::from_ref(b)));
        }
        assert_eq!(out, text);
        let mut d = Utf8Decoder::default();
        assert_eq!(d.push(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }

    #[tokio::test]
    async fn streams_head_chunks_end() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("authorization", "Bearer sk-live"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                "data: {\"x\":\"ü\"}\n\ndata: [DONE]\n\n",
                "text/event-stream",
            ))
            .mount(&server)
            .await;
        let base = format!("{}/v1", server.uri());
        let p = provider("openai-compatible", "apiKey", Some(&base));
        let store = MemoryStore::default();
        store.set("p1", "sk-live").unwrap();
        let oauth = OAuth::new(Arc::new(MemoryStore::default()));
        let prepared = prepare(
            &req(
                &format!("{base}/chat/completions"),
                &[("Authorization", "Bearer dummy")],
            ),
            Some(&p),
            &store,
            &oauth,
        )
        .await
        .unwrap();
        let (_tx, rx) = oneshot::channel();
        let mut events = vec![];
        run(&stream_client(), prepared, rx, |e| events.push(e)).await;
        match &events[0] {
            ProxyEvent::Head { status, headers } => {
                assert_eq!(*status, 200);
                assert_eq!(
                    headers.get("content-type").map(String::as_str),
                    Some("text/event-stream")
                );
            }
            e => panic!("{e:?}"),
        }
        let body: String = events
            .iter()
            .filter_map(|e| match e {
                ProxyEvent::Chunk { data } => Some(data.as_str()),
                _ => None,
            })
            .collect();
        assert!(body.contains("ü") && body.ends_with("[DONE]\n\n"));
        assert_eq!(events.last(), Some(&ProxyEvent::End));
    }

    #[tokio::test]
    async fn abort_and_connect_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(5)))
            .mount(&server)
            .await;
        let prepared = Prepared {
            url: server.uri(),
            method: "GET".into(),
            headers: vec![],
            body: None,
            forbidden_message: None,
        };
        let inflight = Inflight::default();
        let rx = inflight.register("a");
        let started = std::time::Instant::now();
        let handle = tokio::spawn(async move {
            let mut ev = vec![];
            run(&stream_client(), prepared, rx, |e| ev.push(e)).await;
            ev
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(inflight.abort("a"));
        let ev = handle.await.unwrap();
        assert_eq!(
            ev,
            vec![ProxyEvent::Error {
                message: "aborted".into()
            }]
        );
        assert!(started.elapsed() < Duration::from_secs(2));

        let prepared = Prepared {
            url: "http://127.0.0.1:9/x".into(),
            method: "GET".into(),
            headers: vec![],
            body: None,
            forbidden_message: None,
        };
        let (_tx, rx) = oneshot::channel();
        let mut ev = vec![];
        run(&stream_client(), prepared, rx, |e| ev.push(e)).await;
        assert!(
            matches!(&ev[..], [ProxyEvent::Error { message }] if message.contains("Couldn't connect"))
        );
    }

    #[tokio::test]
    async fn forbidden_maps_for_xai_oauth() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let prepared = Prepared {
            url: server.uri(),
            method: "POST".into(),
            headers: vec![],
            body: None,
            forbidden_message: Some("plan".into()),
        };
        let (_tx, rx) = oneshot::channel();
        let mut ev = vec![];
        run(&stream_client(), prepared, rx, |e| ev.push(e)).await;
        assert_eq!(
            ev,
            vec![ProxyEvent::Error {
                message: "plan".into()
            }]
        );
    }

    #[tokio::test]
    async fn get_text_follows_redirects_and_caps() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/old"))
            .respond_with(ResponseTemplate::new(301).insert_header("location", "/new"))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/new"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/html")
                    .set_body_bytes(b"<p>caf\xc3\xa9 \xff</p>".to_vec()),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/big"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![b'a'; PAGE_LIMIT + 1]))
            .mount(&server)
            .await;
        let page = get_text(&page_client(), &format!("{}/old", server.uri()), None)
            .await
            .unwrap();
        assert_eq!(page.status, 200);
        assert!(page.url.ends_with("/new"));
        assert_eq!(page.content_type.as_deref(), Some("text/html"));
        assert_eq!(page.body, "<p>café \u{FFFD}</p>");
        assert!(
            get_text(&page_client(), &format!("{}/big", server.uri()), None)
                .await
                .is_err()
        );
        assert!(get_text(&page_client(), "file:///etc/passwd", None)
            .await
            .is_err());
    }

    /// Streams a real chat completion from the dev LM Studio server with thinking off.
    #[tokio::test]
    #[ignore]
    async fn live_lmstudio_stream() {
        let base = "http://192.168.1.20:1234/v1";
        let p = provider("lmstudio", "local", Some(base));
        let body = serde_json::json!({
            "model": "qwen3.5-9b",
            "stream": true,
            "reasoning_effort": "none",
            "messages": [{"role": "user", "content": "Say hi in three words."}],
        });
        let mut r = req(
            &format!("{base}/chat/completions"),
            &[("content-type", "application/json")],
        );
        r.body = Some(body.to_string());
        let prepared = prepare(
            &r,
            Some(&p),
            &MemoryStore::default(),
            &OAuth::new(Arc::new(MemoryStore::default())),
        )
        .await
        .unwrap();
        let (_tx, rx) = oneshot::channel();
        let mut events = vec![];
        run(&stream_client(), prepared, rx, |e| events.push(e)).await;
        let body: String = events
            .iter()
            .filter_map(|e| match e {
                ProxyEvent::Chunk { data } => Some(data.as_str()),
                _ => None,
            })
            .collect();
        let mut content = String::new();
        let mut reasoning = String::new();
        for line in body.lines().filter_map(|l| l.strip_prefix("data: ")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                let d = &v["choices"][0]["delta"];
                content.push_str(d["content"].as_str().unwrap_or(""));
                reasoning.push_str(d["reasoning_content"].as_str().unwrap_or(""));
            }
        }
        println!(
            "events: {}, content: {content:?}, reasoning chars: {}",
            events.len(),
            reasoning.len()
        );
        assert!(matches!(events[0], ProxyEvent::Head { status: 200, .. }));
        assert_eq!(events.last(), Some(&ProxyEvent::End));
        assert!(!content.trim().is_empty());
        assert!(reasoning.is_empty());
    }

    /// Real cloud provider through the proxy: the key is injected from the secret store and the JS
    /// side's fake Authorization header is dropped. Needs OPENROUTER_API_KEY.
    #[tokio::test]
    #[ignore]
    async fn live_openrouter_long_stream() {
        let Ok(key) = std::env::var("OPENROUTER_API_KEY") else {
            eprintln!("OPENROUTER_API_KEY not set");
            return;
        };
        let p = provider("openrouter", "apiKey", Some("https://openrouter.ai/api/v1"));
        let secrets = MemoryStore::default();
        secrets.set(&p.id, &key).unwrap();
        for round in 0..4 {
            let body = serde_json::json!({
                "model": "deepseek/deepseek-v4.1-flash",
                "stream": true,
                "reasoning_effort": "none",
                "messages": [{"role": "user", "content": "Schreib einen ausführlichen Lernplan (ca. 500 Wörter) für 25 Minuten Biologie mit Listen, Gedankenstrichen und Umlauten."}],
            });
            let mut r = req(
                "https://openrouter.ai/api/v1/chat/completions",
                &[
                    ("content-type", "application/json"),
                    ("authorization", "Bearer managed-by-backend"),
                ],
            );
            r.body = Some(body.to_string());
            let prepared = prepare(
                &r,
                Some(&p),
                &secrets,
                &OAuth::new(Arc::new(MemoryStore::default())),
            )
            .await
            .unwrap();
            let (_tx, rx) = oneshot::channel();
            let mut events = vec![];
            let start = std::time::Instant::now();
            let mut gaps = vec![];
            let mut last = std::time::Instant::now();
            run(&stream_client(), prepared, rx, |e| {
                gaps.push(last.elapsed().as_millis());
                last = std::time::Instant::now();
                events.push(e)
            })
            .await;
            let max_gap = gaps.iter().copied().max().unwrap_or(0);
            println!(
                "round {round}: {} events in {:?}, max gap {max_gap} ms, last {:?}",
                events.len(),
                start.elapsed(),
                events.last()
            );
            assert_eq!(events.last(), Some(&ProxyEvent::End));
        }
    }

    /// Real cloud provider through the proxy: the key is injected from the secret store and the JS
    /// side's fake Authorization header is dropped. Needs OPENROUTER_API_KEY.
    #[tokio::test]
    #[ignore]
    async fn live_openrouter_stream() {
        let Ok(key) = std::env::var("OPENROUTER_API_KEY") else {
            eprintln!("OPENROUTER_API_KEY not set");
            return;
        };
        let p = provider("openrouter", "apiKey", Some("https://openrouter.ai/api/v1"));
        let secrets = MemoryStore::default();
        secrets.set(&p.id, &key).unwrap();
        let body = serde_json::json!({
            "model": "deepseek/deepseek-v4.1-flash",
            "stream": true,
            "reasoning_effort": "none",
            "messages": [{"role": "user", "content": "Say hi in three words."}],
        });
        let mut r = req(
            "https://openrouter.ai/api/v1/chat/completions",
            &[
                ("content-type", "application/json"),
                ("authorization", "Bearer managed-by-backend"),
            ],
        );
        r.body = Some(body.to_string());
        let prepared = prepare(
            &r,
            Some(&p),
            &secrets,
            &OAuth::new(Arc::new(MemoryStore::default())),
        )
        .await
        .unwrap();
        let (_tx, rx) = oneshot::channel();
        let mut events = vec![];
        run(&stream_client(), prepared, rx, |e| events.push(e)).await;
        let body: String = events
            .iter()
            .filter_map(|e| match e {
                ProxyEvent::Chunk { data } => Some(data.as_str()),
                _ => None,
            })
            .collect();
        let content: String = body
            .lines()
            .filter_map(|l| l.strip_prefix("data: "))
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter_map(|v| {
                v["choices"][0]["delta"]["content"]
                    .as_str()
                    .map(str::to_string)
            })
            .collect();
        println!("events: {}, content: {content:?}", events.len());
        assert!(
            matches!(events[0], ProxyEvent::Head { status: 200, .. }),
            "{:?}",
            events.first()
        );
        assert_eq!(events.last(), Some(&ProxyEvent::End));
        assert!(!content.trim().is_empty());
    }
    /// One-connection HTTP/1.1 server that writes `pieces` (delay ms, bytes) and then either ends
    /// the chunked body properly or drops the socket.
    async fn raw_sse(pieces: Vec<(u64, Vec<u8>)>, clean_end: bool) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let _ = sock.read(&mut buf).await;
            sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
            for (delay, bytes) in pieces {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                sock.write_all(format!("{:x}\r\n", bytes.len()).as_bytes())
                    .await
                    .unwrap();
                sock.write_all(&bytes).await.unwrap();
                sock.write_all(b"\r\n").await.unwrap();
                sock.flush().await.unwrap();
            }
            if clean_end {
                sock.write_all(b"0\r\n\r\n").await.unwrap();
            }
            drop(sock);
        });
        format!("http://{addr}/v1/chat/completions")
    }

    fn sse_event(content: &str) -> String {
        format!(
            "data: {}\n\n",
            serde_json::json!({"choices": [{"delta": {"content": content}}]})
        )
    }

    async fn run_raw(url: String) -> (Vec<(Duration, ProxyEvent)>, String) {
        let prepared = Prepared {
            url,
            method: "POST".into(),
            headers: vec![],
            body: Some("{}".into()),
            forbidden_message: None,
        };
        let (_tx, rx) = oneshot::channel();
        let start = std::time::Instant::now();
        let mut events = vec![];
        run(&stream_client(), prepared, rx, |e| {
            events.push((start.elapsed(), e))
        })
        .await;
        let body = events
            .iter()
            .filter_map(|(_, e)| match e {
                ProxyEvent::Chunk { data } => Some(data.as_str()),
                _ => None,
            })
            .collect();
        (events, body)
    }

    #[tokio::test]
    async fn chunks_arrive_before_a_pause_ends() {
        let pieces = vec![
            (0, sse_event("Hallo ").into_bytes()),
            (1500, sse_event("Welt").into_bytes()),
            (0, b"data: [DONE]\n\n".to_vec()),
        ];
        let (events, body) = run_raw(raw_sse(pieces, true).await).await;
        let first = events
            .iter()
            .find(|(_, e)| matches!(e, ProxyEvent::Chunk { data } if data.contains("Hallo")))
            .unwrap();
        assert!(
            first.0 < Duration::from_millis(1000),
            "first chunk held back until {:?}",
            first.0
        );
        assert!(body.contains("Welt"));
        assert_eq!(events.last().unwrap().1, ProxyEvent::End);
    }

    #[tokio::test]
    async fn split_utf8_and_json_reassemble() {
        let full = format!(
            "{}{}data: [DONE]\n\n",
            sse_event("Lichtenergie — Grüße 🌱"),
            sse_event("O₂")
        );
        let bytes = full.as_bytes();
        let pieces = bytes.chunks(3).map(|c| (1, c.to_vec())).collect();
        let (events, body) = run_raw(raw_sse(pieces, true).await).await;
        assert_eq!(body, full);
        assert!(!body.contains('\u{FFFD}'));
        assert_eq!(events.last().unwrap().1, ProxyEvent::End);
    }

    #[tokio::test]
    async fn drop_after_final_event_is_not_an_error() {
        let pieces = vec![
            (0, sse_event("done").into_bytes()),
            (0, b"data: [DONE]\n\n".to_vec()),
        ];
        let (events, _) = run_raw(raw_sse(pieces, false).await).await;
        assert_eq!(events.last().unwrap().1, ProxyEvent::End);
    }

    #[tokio::test]
    async fn drop_mid_answer_says_so() {
        let pieces = vec![(0, sse_event("half an ").into_bytes())];
        let (events, body) = run_raw(raw_sse(pieces, false).await).await;
        assert!(body.contains("half an"));
        match &events.last().unwrap().1 {
            ProxyEvent::Error { message } => assert!(
                message.contains("closed before the answer finished"),
                "{message}"
            ),
            e => panic!("{e:?}"),
        }
    }

    #[test]
    fn sse_end_markers() {
        assert!(sse_finished("data: {}\n\ndata: [DONE]\n\n"));
        assert!(sse_finished(
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        ));
        assert!(sse_finished(
            "data: {\"candidates\":[{\"finishReason\":\"STOP\"}]}\r\n\r\n"
        ));
        assert!(!sse_finished("data: {\"choices\":[]}\n\n"));
        assert!(!sse_finished("data: [DO"));
    }

    /// Probes `run` against `scripts/mock-sse-server.ts` (MOCK_SSE=http://127.0.0.1:18765/v1).
    #[tokio::test]
    #[ignore]
    async fn probe_mock_sse() {
        let Ok(base) = std::env::var("MOCK_SSE") else {
            return;
        };
        let models = std::env::var("MOCK_MODELS")
            .unwrap_or_else(|_| "plain,split,pause-5,close-early,close-after-done,gzip".into());
        for model in models.split(',') {
            let body = serde_json::json!({"model": model, "stream": true, "messages": []});
            let prepared = Prepared {
                url: format!("{base}/chat/completions"),
                method: "POST".into(),
                headers: vec![("content-type".into(), "application/json".into())],
                body: Some(body.to_string()),
                forbidden_message: None,
            };
            let (_tx, rx) = oneshot::channel();
            let start = std::time::Instant::now();
            let mut log = vec![];
            let mut bytes = 0usize;
            run(&stream_client(), prepared, rx, |e| {
                if let ProxyEvent::Chunk { data } = &e {
                    bytes += data.len();
                }
                log.push((
                    start.elapsed().as_millis(),
                    match &e {
                        ProxyEvent::Chunk { .. } => "chunk".to_string(),
                        other => format!("{other:?}"),
                    },
                ));
            })
            .await;
            let max_gap = log.windows(2).map(|w| w[1].0 - w[0].0).max().unwrap_or(0);
            println!(
                "{model}: {} events, {bytes} bytes, {} ms, max gap {max_gap} ms, last {:?}",
                log.len(),
                start.elapsed().as_millis(),
                log.last()
            );
        }
    }
}
