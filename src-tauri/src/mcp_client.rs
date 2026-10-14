//! MCP client: connects to the MCP servers the learner added in Settings (stdio or Streamable HTTP) and calls their tools for chat.

use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::commands::providers::ProviderServices;
use crate::error::{invalid, AppError, AppResult};
use crate::mcp_oauth::{self, McpAuth};

const PROTOCOL: &str = "2025-06-18";
const START_TIMEOUT: Duration = Duration::from_secs(60);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_RESULT_CHARS: usize = 20_000;

#[derive(Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub id: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Streamable HTTP endpoint; when set, `command` is ignored.
    #[serde(default)]
    pub url: Option<String>,
}

impl ServerConfig {
    fn remote(&self) -> Option<&str> {
        self.url.as_deref().map(str::trim).filter(|u| !u.is_empty())
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CallResult {
    pub text: String,
    pub is_error: bool,
}

fn other(msg: impl Into<String>) -> AppError {
    AppError::Other(msg.into())
}

pub struct Session<R, W> {
    reader: R,
    writer: W,
    next_id: i64,
}

impl<R: AsyncBufRead + Unpin, W: AsyncWrite + Unpin> Session<R, W> {
    pub fn new(reader: R, writer: W) -> Self {
        Self {
            reader,
            writer,
            next_id: 0,
        }
    }

    async fn send(&mut self, msg: &Value) -> AppResult<()> {
        let mut line = serde_json::to_vec(msg)?;
        line.push(b'\n');
        self.writer.write_all(&line).await?;
        Ok(self.writer.flush().await?)
    }
}

impl<R: AsyncBufRead + Unpin, W: AsyncWrite + Unpin> Rpc for Session<R, W> {
    async fn request(&mut self, method: &str, params: Value) -> AppResult<Value> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        loop {
            let mut line = String::new();
            if self.reader.read_line(&mut line).await? == 0 {
                return Err(other("The MCP server stopped."));
            }
            // some servers print banners or logs on stdout; anything that isn't JSON-RPC is skipped
            let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if let Some(m) = msg.get("method").and_then(Value::as_str) {
                if let Some(rid) = msg.get("id") {
                    let reply = if m == "ping" {
                        json!({ "jsonrpc": "2.0", "id": rid, "result": {} })
                    } else {
                        json!({ "jsonrpc": "2.0", "id": rid, "error": { "code": -32601, "message": "Not supported by Ponder" } })
                    };
                    self.send(&reply).await?;
                }
                continue;
            }
            if let Some(r) = response_for(&msg, id) {
                return r;
            }
        }
    }

    async fn notify(&mut self, method: &str) -> AppResult<()> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method }))
            .await
    }
}

/// The result or error when `msg` is the response to request `id`.
fn response_for(msg: &Value, id: i64) -> Option<AppResult<Value>> {
    if msg.get("method").is_some() || msg.get("id").and_then(Value::as_i64) != Some(id) {
        return None;
    }
    if let Some(e) = msg.get("error") {
        let text = e
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        return Some(Err(other(format!("MCP error: {text}"))));
    }
    Some(Ok(msg.get("result").cloned().unwrap_or(Value::Null)))
}

trait Rpc {
    async fn request(&mut self, method: &str, params: Value) -> AppResult<Value>;
    async fn notify(&mut self, method: &str) -> AppResult<()>;

    async fn initialize(&mut self) -> AppResult<()> {
        self.request(
            "initialize",
            json!({ "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": { "name": "Ponder", "version": env!("CARGO_PKG_VERSION") } }),
        )
        .await?;
        self.notify("notifications/initialized").await
    }

    async fn list_tools(&mut self) -> AppResult<Vec<ToolInfo>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = cursor
                .as_ref()
                .map_or_else(|| json!({}), |c| json!({ "cursor": c }));
            let res = self.request("tools/list", params).await?;
            for t in res
                .get("tools")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(name) = t.get("name").and_then(Value::as_str) else {
                    continue;
                };
                tools.push(ToolInfo {
                    name: name.to_string(),
                    description: t
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    input_schema: t
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                });
            }
            cursor = res
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Ok(tools)
    }

    async fn call_tool(&mut self, name: &str, arguments: Value) -> AppResult<CallResult> {
        let args = if arguments.is_object() {
            arguments
        } else {
            json!({})
        };
        let res = self
            .request("tools/call", json!({ "name": name, "arguments": args }))
            .await?;
        Ok(result_text(&res))
    }
}

/// Streamable HTTP transport: every message is a POST; replies come back as JSON or as an SSE stream.
pub struct HttpSession {
    client: reqwest::Client,
    url: String,
    headers: Vec<(String, String)>,
    session_id: Option<String>,
    initialized: bool,
    next_id: i64,
}

impl HttpSession {
    pub fn new(url: &str, headers: Vec<(String, String)>) -> AppResult<Self> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|_| invalid("Enter the server's full URL, starting with https://."))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(invalid(
                "Enter the server's full URL, starting with https://.",
            ));
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| other(e.to_string()))?;
        Ok(Self {
            client,
            url: url.to_string(),
            headers,
            session_id: None,
            initialized: false,
            next_id: 0,
        })
    }

    async fn post(&mut self, msg: &Value) -> AppResult<reqwest::Response> {
        let mut req = self
            .client
            .post(&self.url)
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            )
            .header(reqwest::header::CONTENT_TYPE, "application/json");
        if self.initialized {
            req = req.header("MCP-Protocol-Version", PROTOCOL);
        }
        if let Some(sid) = &self.session_id {
            req = req.header("Mcp-Session-Id", sid);
        }
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let res = req
            .body(serde_json::to_vec(msg)?)
            .send()
            .await
            .map_err(|e| other(format!("Couldn't reach the MCP server: {e}")))?;
        if let Some(sid) = res
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            self.session_id = Some(sid.to_string());
        }
        let status = res.status();
        if status.is_success() {
            return Ok(res);
        }
        if status == reqwest::StatusCode::NOT_FOUND && self.session_id.is_some() {
            self.session_id = None;
            return Err(other("The MCP server ended the session."));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth(
                "This MCP server needs you to sign in.".into(),
            ));
        }
        Err(other(match status.as_u16() {
            403 => format!("The MCP server refused the request ({status}). Check the headers."),
            301..=308 => {
                format!("The MCP server redirected the request ({status}). Use the final URL.")
            }
            _ => format!("The MCP server answered {status}."),
        }))
    }
}

impl HttpSession {
    /// The `WWW-Authenticate` header the server answers an unauthenticated `initialize` with.
    async fn probe(&self) -> Option<String> {
        let body = json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": { "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": { "name": "Ponder", "version": env!("CARGO_PKG_VERSION") } } });
        let res = self
            .client
            .post(&self.url)
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            )
            .json(&body)
            .send()
            .await
            .ok()?;
        res.headers()
            .get(reqwest::header::WWW_AUTHENTICATE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    }
}

impl Rpc for HttpSession {
    async fn request(&mut self, method: &str, params: Value) -> AppResult<Value> {
        self.next_id += 1;
        let id = self.next_id;
        let res = self
            .post(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        let sse = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|t| t.starts_with("text/event-stream"));
        let found = if sse {
            let mut stream = res.bytes_stream();
            let mut buf = String::new();
            let mut found = None;
            'read: while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
                buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| {
                    other(format!("The MCP server's reply broke off: {e}"))
                })?));
                for data in sse_events(&mut buf) {
                    if let Ok(msg) = serde_json::from_str::<Value>(&data) {
                        if let Some(r) = messages(&msg).find_map(|m| response_for(m, id)) {
                            found = Some(r);
                            break 'read;
                        }
                    }
                }
            }
            found
        } else {
            let body: Value = res
                .json()
                .await
                .map_err(|e| other(format!("The MCP server sent an unreadable reply: {e}")))?;
            let found = messages(&body).find_map(|m| response_for(m, id));
            found
        };
        if method == "initialize" {
            self.initialized = true;
        }
        found.unwrap_or_else(|| Err(other("The MCP server didn't answer the request.")))
    }

    async fn notify(&mut self, method: &str) -> AppResult<()> {
        self.post(&json!({ "jsonrpc": "2.0", "method": method }))
            .await
            .map(|_| ())
    }
}

fn messages(v: &Value) -> Box<dyn Iterator<Item = &Value> + '_> {
    match v.as_array() {
        Some(a) => Box::new(a.iter()),
        None => Box::new(std::iter::once(v)),
    }
}

/// Removes complete events from `buf` and returns their `data` payloads.
pub fn sse_events(buf: &mut String) -> Vec<String> {
    let mut out = Vec::new();
    loop {
        let normalized = buf.replace("\r\n", "\n");
        if normalized.len() != buf.len() {
            *buf = normalized;
        }
        let Some(end) = buf.find("\n\n") else { break };
        let event: String = buf.drain(..end + 2).collect();
        let data: Vec<&str> = event
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|d| d.strip_prefix(' ').unwrap_or(d))
            .collect();
        if !data.is_empty() {
            out.push(data.join("\n"));
        }
    }
    out
}

/// Flattens a `tools/call` result to text the model can read.
pub fn result_text(res: &Value) -> CallResult {
    let mut parts = Vec::new();
    for c in res
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match c.get("type").and_then(Value::as_str) {
            Some("text") => parts.push(
                c.get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            ),
            Some("resource") => {
                let r = c.get("resource").unwrap_or(&Value::Null);
                match r.get("text").and_then(Value::as_str) {
                    Some(t) => parts.push(t.to_string()),
                    None => parts.push(format!(
                        "[resource {}]",
                        r.get("uri").and_then(Value::as_str).unwrap_or("")
                    )),
                }
            }
            Some("resource_link") => parts.push(format!(
                "[link {}]",
                c.get("uri").and_then(Value::as_str).unwrap_or("")
            )),
            Some(kind) => parts.push(format!("[{kind}]")),
            None => {}
        }
    }
    if parts.is_empty() {
        if let Some(sc) = res.get("structuredContent") {
            parts.push(sc.to_string());
        }
    }
    let mut text = parts.join("\n");
    if text.chars().count() > MAX_RESULT_CHARS {
        text = text.chars().take(MAX_RESULT_CHARS).collect::<String>() + "\n[truncated]";
    }
    CallResult {
        text,
        is_error: res.get("isError").and_then(Value::as_bool).unwrap_or(false),
    }
}

/// `KEY=value` lines; blank lines and `#` comments are skipped.
pub fn parse_env(text: &str) -> Vec<(String, String)> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .filter(|(k, _)| !k.is_empty())
        .collect()
}

/// `Name: value` (or `Name=value`) lines for a remote server.
pub fn parse_headers(text: &str) -> Vec<(String, String)> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let at = l.find([':', '='])?;
            Some((l[..at].trim().to_string(), l[at + 1..].trim().to_string()))
        })
        .filter(|(k, _)| !k.is_empty())
        .collect()
}

pub fn env_account(id: &str) -> String {
    format!("mcp-env:{id}")
}

/// Apps started from Finder get a minimal PATH, so `npx`/`uvx` wouldn't be found. Ask the login shell once.
#[cfg(unix)]
async fn shell_path() -> Option<String> {
    static PATH: tokio::sync::OnceCell<Option<String>> = tokio::sync::OnceCell::const_new();
    PATH.get_or_init(|| async {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let out = tokio::time::timeout(
            Duration::from_secs(5),
            Command::new(shell)
                .args([
                    "-ilc",
                    "printf '\\n__PONDER_PATH__%s__PONDER_PATH__\\n' \"$PATH\"",
                ])
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output(),
        )
        .await
        .ok()?
        .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        let start = s.find("__PONDER_PATH__")? + "__PONDER_PATH__".len();
        let end = start + s[start..].find("__PONDER_PATH__")?;
        Some(s[start..end].to_string()).filter(|p| !p.is_empty())
    })
    .await
    .clone()
}

enum Conn {
    Stdio {
        _child: Child,
        session: Session<BufReader<ChildStdout>, ChildStdin>,
    },
    Http(HttpSession),
}

struct Running {
    config: ServerConfig,
    secret: Option<String>,
    bearer: Option<String>,
    conn: Conn,
    tools: Vec<ToolInfo>,
}

impl Running {
    async fn call_tool(&mut self, name: &str, arguments: Value) -> AppResult<CallResult> {
        match &mut self.conn {
            Conn::Stdio { session, .. } => session.call_tool(name, arguments).await,
            Conn::Http(session) => session.call_tool(name, arguments).await,
        }
    }
}

async fn start(
    config: &ServerConfig,
    secret: Option<&str>,
    bearer: Option<&str>,
) -> AppResult<Running> {
    if let Some(url) = config.remote() {
        let mut headers = secret.map(parse_headers).unwrap_or_default();
        if let Some(token) = bearer {
            headers.retain(|(k, _)| !k.eq_ignore_ascii_case("authorization"));
            headers.push(("Authorization".into(), format!("Bearer {token}")));
        }
        let mut session = HttpSession::new(url, headers)?;
        let tools = match tokio::time::timeout(START_TIMEOUT, async {
            session.initialize().await?;
            session.list_tools().await
        })
        .await
        {
            Ok(r) => r?,
            Err(_) => return Err(other("The MCP server didn't answer within a minute.")),
        };
        return Ok(Running {
            config: config.clone(),
            secret: secret.map(str::to_string),
            bearer: bearer.map(str::to_string),
            conn: Conn::Http(session),
            tools,
        });
    }
    let env = secret.map(parse_env).unwrap_or_default();
    let command = config.command.trim();
    if command.is_empty() {
        return Err(invalid("Add the command that starts the server."));
    }
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command).args(&config.args);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new(command);
        c.args(&config.args);
        if let Some(path) = shell_path().await {
            c.env("PATH", path);
        }
        c
    };
    cmd.envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| other(format!("Couldn't start {command}: {e}")))?;
    let stdin = child.stdin.take().ok_or_else(|| other("no stdin"))?;
    let stdout = child.stdout.take().ok_or_else(|| other("no stdout"))?;
    let stderr_lines = Arc::new(std::sync::Mutex::new(VecDeque::new()));
    if let Some(err) = child.stderr.take() {
        let sink = stderr_lines.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                if l.trim().is_empty() {
                    continue;
                }
                let Ok(mut q) = sink.lock() else { break };
                if q.len() >= 20 {
                    q.pop_front();
                }
                q.push_back(l);
            }
        });
    }
    let mut session = Session::new(BufReader::new(stdout), stdin);
    let init = tokio::time::timeout(START_TIMEOUT, async {
        session.initialize().await?;
        session.list_tools().await
    })
    .await;
    match init {
        Ok(Ok(tools)) => Ok(Running {
            config: config.clone(),
            secret: secret.map(str::to_string),
            bearer: None,
            conn: Conn::Stdio {
                _child: child,
                session,
            },
            tools,
        }),
        Ok(Err(e)) => {
            // let the stderr reader catch up with a server that just exited
            tokio::time::sleep(Duration::from_millis(150)).await;
            let last = stderr_lines.lock().ok().and_then(|q| q.back().cloned());
            Err(other(match last {
                Some(l) => format!("{e} ({l})"),
                None => e.to_string(),
            }))
        }
        Err(_) => Err(other("The MCP server didn't answer within a minute.")),
    }
}

#[derive(Default)]
pub struct McpClients {
    running: Mutex<HashMap<String, Arc<Mutex<Option<Running>>>>>,
}

impl McpClients {
    async fn slot(&self, id: &str) -> Arc<Mutex<Option<Running>>> {
        self.running
            .lock()
            .await
            .entry(id.to_string())
            .or_default()
            .clone()
    }
}

/// Environment variables for a local server, headers for a remote one.
async fn read_secret(svc: &ProviderServices, id: &str) -> AppResult<Option<String>> {
    let store = svc.secrets.clone();
    let account = env_account(id);
    tokio::task::spawn_blocking(move || store.get(&account))
        .await
        .map_err(|e| other(e.to_string()))?
}

async fn read_auth(svc: &ProviderServices, id: &str) -> AppResult<Option<McpAuth>> {
    let store = svc.secrets.clone();
    let account = mcp_oauth::auth_account(id);
    let text = tokio::task::spawn_blocking(move || store.get(&account))
        .await
        .map_err(|e| other(e.to_string()))??;
    Ok(text.and_then(|t| serde_json::from_str(&t).ok()))
}

async fn save_auth(svc: &ProviderServices, id: &str, auth: &McpAuth) -> AppResult<()> {
    let store = svc.secrets.clone();
    let account = mcp_oauth::auth_account(id);
    let text = serde_json::to_string(auth)?;
    tokio::task::spawn_blocking(move || store.set(&account, &text))
        .await
        .map_err(|e| other(e.to_string()))?
}

/// The signed-in access token for a remote server, refreshed when it's about to expire.
async fn bearer(svc: &ProviderServices, config: &ServerConfig) -> AppResult<Option<String>> {
    if config.remote().is_none() {
        return Ok(None);
    }
    let Some(auth) = read_auth(svc, &config.id).await? else {
        return Ok(None);
    };
    if !auth
        .tokens
        .needs_refresh(crate::oauth::tokens::now_ms(), 60_000)
    {
        return Ok(Some(auth.tokens.access));
    }
    let fresh = mcp_oauth::refresh(&svc.page_http, &auth)
        .await
        .map_err(|e| AppError::Auth(e.to_string()))?;
    save_auth(svc, &config.id, &fresh).await?;
    Ok(Some(fresh.tokens.access))
}

async fn ensure(
    slot: &mut Option<Running>,
    svc: &ProviderServices,
    config: &ServerConfig,
) -> AppResult<()> {
    // the slot lock is held, so a refresh here can't race another call to the same server
    let secret = read_secret(svc, &config.id).await?;
    let bearer = bearer(svc, config).await?;
    let fresh =
        matches!(slot, Some(r) if r.config == *config && r.secret == secret && r.bearer == bearer);
    if !fresh {
        *slot = None;
        *slot = Some(start(config, secret.as_deref(), bearer.as_deref()).await?);
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_client_tools(
    clients: State<'_, McpClients>,
    svc: State<'_, ProviderServices>,
    server: ServerConfig,
) -> AppResult<Vec<ToolInfo>> {
    let slot = clients.slot(&server.id).await;
    let mut guard = slot.lock().await;
    ensure(&mut guard, &svc, &server).await?;
    Ok(guard.as_ref().map(|r| r.tools.clone()).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_client_call(
    clients: State<'_, McpClients>,
    svc: State<'_, ProviderServices>,
    server: ServerConfig,
    tool: String,
    arguments: Value,
) -> AppResult<CallResult> {
    let slot = clients.slot(&server.id).await;
    let mut guard = slot.lock().await;
    ensure(&mut guard, &svc, &server).await?;
    let run = guard
        .as_mut()
        .ok_or_else(|| other("The MCP server isn't running."))?;
    match tokio::time::timeout(CALL_TIMEOUT, run.call_tool(&tool, arguments)).await {
        Ok(Ok(r)) => Ok(r),
        Ok(Err(e)) => {
            let msg = e.to_string();
            if msg.contains("stopped")
                || msg.contains("ended the session")
                || matches!(e, AppError::Auth(_))
            {
                *guard = None;
            }
            Err(e)
        }
        Err(_) => {
            // the reply may still arrive later and would be read as the answer to the next call
            *guard = None;
            Err(other(format!("{tool} didn't finish within two minutes.")))
        }
    }
}

#[tauri::command]
pub async fn mcp_client_stop(clients: State<'_, McpClients>, id: String) -> AppResult<()> {
    let slot = clients.running.lock().await.remove(&id);
    if let Some(slot) = slot {
        *slot.lock().await = None;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuthStatus {
    pub signed_in: bool,
}

#[tauri::command]
pub async fn mcp_client_auth_status(
    svc: State<'_, ProviderServices>,
    id: String,
) -> AppResult<McpAuthStatus> {
    Ok(McpAuthStatus {
        signed_in: read_auth(&svc, &id).await?.is_some(),
    })
}

/// Signs in to a remote server in the browser and waits for the redirect.
#[tauri::command]
pub async fn mcp_client_sign_in(
    app: tauri::AppHandle,
    clients: State<'_, McpClients>,
    svc: State<'_, ProviderServices>,
    server: ServerConfig,
) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let url = server
        .remote()
        .ok_or_else(|| invalid("Only servers added by URL can sign in."))?
        .to_string();
    let http = svc.page_http.clone();
    let challenge = HttpSession::new(&url, vec![])?.probe().await;
    let found = mcp_oauth::discover(&http, &url, challenge.as_deref()).await?;
    let lb = crate::oauth::loopback::Loopback::bind().await?;
    let redirect = lb.redirect_uri();
    let register = found
        .register
        .as_deref()
        .ok_or_else(|| other("This server doesn't let apps register for sign-in. Add its access token as a header instead."))?;
    let (client_id, client_secret) = mcp_oauth::register(&http, register, &redirect).await?;
    let (verifier, state) = mcp_oauth::new_verifier();
    let auth_url = mcp_oauth::authorize_url(&found, &client_id, &redirect, &state, &verifier)?;
    if let Err(e) = app.opener().open_url(auth_url, None::<&str>) {
        return Err(other(format!("Couldn't open the browser: {e}")));
    }
    let cb = lb.wait(&state, SIGN_IN_TIMEOUT).await?;
    let auth = mcp_oauth::exchange(
        &http,
        &found,
        (&client_id, client_secret.as_deref()),
        &cb.code,
        &verifier,
        &redirect,
    )
    .await?;
    save_auth(&svc, &server.id, &auth).await?;
    if let Some(slot) = clients.running.lock().await.remove(&server.id) {
        *slot.lock().await = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_client_sign_out(
    clients: State<'_, McpClients>,
    svc: State<'_, ProviderServices>,
    id: String,
) -> AppResult<()> {
    let store = svc.secrets.clone();
    let account = mcp_oauth::auth_account(&id);
    tokio::task::spawn_blocking(move || store.delete(&account))
        .await
        .map_err(|e| other(e.to_string()))??;
    if let Some(slot) = clients.running.lock().await.remove(&id) {
        *slot.lock().await = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, split};

    async fn fake_server(io: tokio::io::DuplexStream) {
        let (r, mut w) = split(io);
        let mut lines = BufReader::new(r).lines();
        w.write_all(b"starting fake server\n").await.unwrap();
        while let Ok(Some(l)) = lines.next_line().await {
            let msg: Value = serde_json::from_str(&l).unwrap();
            let Some(id) = msg.get("id").cloned() else {
                continue;
            };
            if msg.get("method").is_none() {
                continue;
            }
            let reply = match msg["method"].as_str().unwrap() {
                "initialize" => {
                    json!({ "protocolVersion": PROTOCOL, "capabilities": { "tools": {} }, "serverInfo": { "name": "fake" } })
                }
                "tools/list" if msg["params"].get("cursor").is_none() => {
                    json!({ "tools": [{ "name": "echo", "description": "Echoes", "inputSchema": { "type": "object" } }], "nextCursor": "2" })
                }
                "tools/list" => json!({ "tools": [{ "name": "fail" }] }),
                "tools/call" if msg["params"]["name"] == "fail" => {
                    json!({ "content": [{ "type": "text", "text": "nope" }], "isError": true })
                }
                "tools/call" => {
                    // a server request and a notification arrive before the answer
                    w.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"ping\"}\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n").await.unwrap();
                    let pong = lines.next_line().await.unwrap().unwrap();
                    assert!(pong.contains("\"id\":99") && pong.contains("result"));
                    json!({ "content": [{ "type": "text", "text": format!("you said {}", msg["params"]["arguments"]["text"].as_str().unwrap()) }, { "type": "image", "data": "", "mimeType": "image/png" }] })
                }
                _ => {
                    w.write_all(format!("{}\n", json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "nope" } })).as_bytes()).await.unwrap();
                    continue;
                }
            };
            w.write_all(
                format!(
                    "{}\n",
                    json!({ "jsonrpc": "2.0", "id": id, "result": reply })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn talks_to_a_server() {
        let (client, server) = duplex(64 * 1024);
        tokio::spawn(fake_server(server));
        let (r, w) = split(client);
        let mut s = Session::new(BufReader::new(r), w);
        s.initialize().await.unwrap();
        let tools = s.list_tools().await.unwrap();
        assert_eq!(
            tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            ["echo", "fail"]
        );
        assert_eq!(
            tools[1].input_schema,
            json!({ "type": "object", "properties": {} })
        );
        let r = s.call_tool("echo", json!({ "text": "hi" })).await.unwrap();
        assert_eq!(
            r,
            CallResult {
                text: "you said hi\n[image]".into(),
                is_error: false
            }
        );
        assert!(s.call_tool("fail", Value::Null).await.unwrap().is_error);
        let e = s.request("resources/list", json!({})).await.unwrap_err();
        assert_eq!(e.to_string(), "MCP error: nope");
    }

    /// Minimal Streamable HTTP server: answers `initialize` as JSON and everything else as SSE.
    async fn fake_http_server() -> (String, Arc<std::sync::Mutex<Vec<String>>>) {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let log = log.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head, body) = loop {
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
                            break (head, text[end + 4..end + 4 + len].to_string());
                        }
                    };
                    log.lock().unwrap().push(head.clone());
                    let msg: Value = serde_json::from_str(&body).unwrap();
                    let authed = head.contains("authorization: bearer secret");
                    let (status, ctype, out) = match msg.get("id") {
                        _ if !authed => ("401 Unauthorized", "text/plain", "no".to_string()),
                        None => ("202 Accepted", "text/plain", String::new()),
                        Some(id) => {
                            let method = msg["method"].as_str().unwrap();
                            if method != "initialize" && !head.contains("mcp-session-id: s1") {
                                ("400 Bad Request", "text/plain", "no session".to_string())
                            } else {
                                let result = match method {
                                    "initialize" => {
                                        json!({ "protocolVersion": PROTOCOL, "capabilities": { "tools": {} } })
                                    }
                                    "tools/list" => json!({ "tools": [{ "name": "echo" }] }),
                                    _ => {
                                        json!({ "content": [{ "type": "text", "text": msg["params"]["arguments"]["text"] }] })
                                    }
                                };
                                let reply = json!({ "jsonrpc": "2.0", "id": id, "result": result })
                                    .to_string();
                                if method == "initialize" {
                                    ("200 OK", "application/json", reply)
                                } else {
                                    let progress = json!({ "jsonrpc": "2.0", "method": "notifications/progress", "params": {} });
                                    ("200 OK", "text/event-stream", format!(": hi\r\n\r\nevent: message\ndata: {progress}\n\nid: 1\ndata: {reply}\n\n"))
                                }
                            }
                        }
                    };
                    let resp = format!("HTTP/1.1 {status}\r\ncontent-type: {ctype}\r\nmcp-session-id: s1\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{out}", out.len());
                    sock.write_all(resp.as_bytes()).await.unwrap();
                });
            }
        });
        (url, seen)
    }

    #[tokio::test]
    async fn talks_to_a_remote_server() {
        let (url, seen) = fake_http_server().await;
        let cfg = ServerConfig {
            id: "r".into(),
            command: String::new(),
            args: vec![],
            url: Some(url.clone()),
        };
        let mut run = start(
            &cfg,
            Some("# token\nAuthorization: Bearer wrong"),
            Some("secret"),
        )
        .await
        .unwrap();
        assert_eq!(
            run.tools
                .iter()
                .map(|t| t.name.as_str())
                .collect::<Vec<_>>(),
            ["echo"]
        );
        assert_eq!(
            run.call_tool("echo", json!({ "text": "hi" }))
                .await
                .unwrap()
                .text,
            "hi"
        );
        let heads = seen.lock().unwrap().clone();
        assert!(!heads[0].contains("mcp-protocol-version"));
        assert!(heads
            .last()
            .unwrap()
            .contains(&format!("mcp-protocol-version: {PROTOCOL}").to_lowercase()));
        let e = start(&cfg, None, None).await.err().unwrap().to_string();
        assert!(e.contains("sign in"), "{e}");
        let bad = ServerConfig {
            url: Some("ftp://x".into()),
            ..cfg
        };
        assert!(start(&bad, None, None).await.is_err());
    }

    #[test]
    fn splits_sse_events() {
        let mut buf = "data: a\ndata: b\n\n: c\r\n\r\ndata:x\n\ndata: par".to_string();
        assert_eq!(sse_events(&mut buf), ["a\nb", "x"]);
        assert_eq!(buf, "data: par");
    }

    #[test]
    fn parses_header_lines() {
        assert_eq!(
            parse_headers("Authorization: Bearer a=b\nX-Key=1\n# c\nnothing"),
            vec![
                ("Authorization".into(), "Bearer a=b".into()),
                ("X-Key".into(), "1".into())
            ]
        );
    }

    #[test]
    fn parses_env_lines() {
        assert_eq!(
            parse_env("A=1\n# c\n\n B = x=y \nnoequals\n=v"),
            vec![("A".into(), "1".into()), ("B".into(), "x=y".into())]
        );
    }

    #[test]
    fn flattens_results() {
        let r = result_text(
            &json!({ "content": [{ "type": "resource", "resource": { "uri": "file:///a", "text": "body" } }, { "type": "resource_link", "uri": "file:///b" }] }),
        );
        assert_eq!(r.text, "body\n[link file:///b]");
        assert_eq!(
            result_text(&json!({ "content": [], "structuredContent": { "n": 1 } })).text,
            "{\"n\":1}"
        );
        assert!(result_text(
            &json!({ "content": [{ "type": "text", "text": "x".repeat(MAX_RESULT_CHARS + 5) }] })
        )
        .text
        .ends_with("[truncated]"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_a_server_that_exits() {
        let cfg = ServerConfig {
            id: "x".into(),
            command: "sh".into(),
            args: vec!["-c".into(), "echo boom >&2; exit 1".into()],
            url: None,
        };
        let e = start(&cfg, None, None).await.err().unwrap().to_string();
        assert!(e.contains("stopped") && e.contains("boom"), "{e}");
    }
}
