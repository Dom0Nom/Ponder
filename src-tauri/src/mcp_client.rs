//! MCP client: runs the stdio MCP servers the learner added in Settings and calls their tools for chat.

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

const PROTOCOL: &str = "2025-06-18";
const START_TIMEOUT: Duration = Duration::from_secs(60);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_RESULT_CHARS: usize = 20_000;

#[derive(Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
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
        Self { reader, writer, next_id: 0 }
    }

    async fn send(&mut self, msg: &Value) -> AppResult<()> {
        let mut line = serde_json::to_vec(msg)?;
        line.push(b'\n');
        self.writer.write_all(&line).await?;
        Ok(self.writer.flush().await?)
    }

    async fn request(&mut self, method: &str, params: Value) -> AppResult<Value> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).await?;
        loop {
            let mut line = String::new();
            if self.reader.read_line(&mut line).await? == 0 {
                return Err(other("The MCP server stopped."));
            }
            // some servers print banners or logs on stdout; anything that isn't JSON-RPC is skipped
            let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else { continue };
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
            if msg.get("id").and_then(Value::as_i64) != Some(id) {
                continue;
            }
            if let Some(e) = msg.get("error") {
                let text = e.get("message").and_then(Value::as_str).unwrap_or("unknown error");
                return Err(other(format!("MCP error: {text}")));
            }
            return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    pub async fn initialize(&mut self) -> AppResult<()> {
        self.request(
            "initialize",
            json!({ "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": { "name": "Ponder", "version": env!("CARGO_PKG_VERSION") } }),
        )
        .await?;
        self.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await
    }

    pub async fn list_tools(&mut self) -> AppResult<Vec<ToolInfo>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = cursor.as_ref().map_or_else(|| json!({}), |c| json!({ "cursor": c }));
            let res = self.request("tools/list", params).await?;
            for t in res.get("tools").and_then(Value::as_array).into_iter().flatten() {
                let Some(name) = t.get("name").and_then(Value::as_str) else { continue };
                tools.push(ToolInfo {
                    name: name.to_string(),
                    description: t.get("description").and_then(Value::as_str).unwrap_or("").to_string(),
                    input_schema: t.get("inputSchema").cloned().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                });
            }
            cursor = res.get("nextCursor").and_then(Value::as_str).map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Ok(tools)
    }

    pub async fn call_tool(&mut self, name: &str, arguments: Value) -> AppResult<CallResult> {
        let args = if arguments.is_object() { arguments } else { json!({}) };
        let res = self.request("tools/call", json!({ "name": name, "arguments": args })).await?;
        Ok(result_text(&res))
    }
}

/// Flattens a `tools/call` result to text the model can read.
pub fn result_text(res: &Value) -> CallResult {
    let mut parts = Vec::new();
    for c in res.get("content").and_then(Value::as_array).into_iter().flatten() {
        match c.get("type").and_then(Value::as_str) {
            Some("text") => parts.push(c.get("text").and_then(Value::as_str).unwrap_or("").to_string()),
            Some("resource") => {
                let r = c.get("resource").unwrap_or(&Value::Null);
                match r.get("text").and_then(Value::as_str) {
                    Some(t) => parts.push(t.to_string()),
                    None => parts.push(format!("[resource {}]", r.get("uri").and_then(Value::as_str).unwrap_or(""))),
                }
            }
            Some("resource_link") => parts.push(format!("[link {}]", c.get("uri").and_then(Value::as_str).unwrap_or(""))),
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
    CallResult { text, is_error: res.get("isError").and_then(Value::as_bool).unwrap_or(false) }
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
            Command::new(shell).args(["-ilc", "printf '\\n__PONDER_PATH__%s__PONDER_PATH__\\n' \"$PATH\""]).stdin(Stdio::null()).stderr(Stdio::null()).output(),
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

struct Running {
    config: ServerConfig,
    env: Vec<(String, String)>,
    _child: Child,
    session: Session<BufReader<ChildStdout>, ChildStdin>,
    stderr: Arc<std::sync::Mutex<VecDeque<String>>>,
    tools: Vec<ToolInfo>,
}

impl Running {
    fn last_stderr(&self) -> Option<String> {
        self.stderr.lock().ok()?.back().cloned()
    }
}

async fn start(config: &ServerConfig, env: &[(String, String)]) -> AppResult<Running> {
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
    cmd.envs(env.iter().cloned()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| other(format!("Couldn't start {command}: {e}")))?;
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
    let mut run = Running { config: config.clone(), env: env.to_vec(), _child: child, session: Session::new(BufReader::new(stdout), stdin), stderr: stderr_lines, tools: vec![] };
    let init = tokio::time::timeout(START_TIMEOUT, async {
        run.session.initialize().await?;
        run.session.list_tools().await
    })
    .await;
    match init {
        Ok(Ok(tools)) => {
            run.tools = tools;
            Ok(run)
        }
        Ok(Err(e)) => {
            // let the stderr reader catch up with a server that just exited
            tokio::time::sleep(Duration::from_millis(150)).await;
            Err(other(match run.last_stderr() {
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
        self.running.lock().await.entry(id.to_string()).or_default().clone()
    }
}

async fn read_env(svc: &ProviderServices, id: &str) -> AppResult<Vec<(String, String)>> {
    let store = svc.secrets.clone();
    let account = env_account(id);
    let text = tokio::task::spawn_blocking(move || store.get(&account)).await.map_err(|e| other(e.to_string()))??;
    Ok(text.map(|t| parse_env(&t)).unwrap_or_default())
}

async fn ensure(slot: &mut Option<Running>, config: &ServerConfig, env: Vec<(String, String)>) -> AppResult<()> {
    let fresh = matches!(slot, Some(r) if r.config == *config && r.env == env);
    if !fresh {
        *slot = None;
        *slot = Some(start(config, &env).await?);
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_client_tools(clients: State<'_, McpClients>, svc: State<'_, ProviderServices>, server: ServerConfig) -> AppResult<Vec<ToolInfo>> {
    let env = read_env(&svc, &server.id).await?;
    let slot = clients.slot(&server.id).await;
    let mut guard = slot.lock().await;
    ensure(&mut guard, &server, env).await?;
    Ok(guard.as_ref().map(|r| r.tools.clone()).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_client_call(clients: State<'_, McpClients>, svc: State<'_, ProviderServices>, server: ServerConfig, tool: String, arguments: Value) -> AppResult<CallResult> {
    let env = read_env(&svc, &server.id).await?;
    let slot = clients.slot(&server.id).await;
    let mut guard = slot.lock().await;
    ensure(&mut guard, &server, env).await?;
    let run = guard.as_mut().ok_or_else(|| other("The MCP server isn't running."))?;
    match tokio::time::timeout(CALL_TIMEOUT, run.session.call_tool(&tool, arguments)).await {
        Ok(Ok(r)) => Ok(r),
        Ok(Err(e)) => {
            if e.to_string().contains("stopped") {
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
            let Some(id) = msg.get("id").cloned() else { continue };
            if msg.get("method").is_none() {
                continue;
            }
            let reply = match msg["method"].as_str().unwrap() {
                "initialize" => json!({ "protocolVersion": PROTOCOL, "capabilities": { "tools": {} }, "serverInfo": { "name": "fake" } }),
                "tools/list" if msg["params"].get("cursor").is_none() => {
                    json!({ "tools": [{ "name": "echo", "description": "Echoes", "inputSchema": { "type": "object" } }], "nextCursor": "2" })
                }
                "tools/list" => json!({ "tools": [{ "name": "fail" }] }),
                "tools/call" if msg["params"]["name"] == "fail" => json!({ "content": [{ "type": "text", "text": "nope" }], "isError": true }),
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
            w.write_all(format!("{}\n", json!({ "jsonrpc": "2.0", "id": id, "result": reply })).as_bytes()).await.unwrap();
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
        assert_eq!(tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["echo", "fail"]);
        assert_eq!(tools[1].input_schema, json!({ "type": "object", "properties": {} }));
        let r = s.call_tool("echo", json!({ "text": "hi" })).await.unwrap();
        assert_eq!(r, CallResult { text: "you said hi\n[image]".into(), is_error: false });
        assert!(s.call_tool("fail", Value::Null).await.unwrap().is_error);
        let e = s.request("resources/list", json!({})).await.unwrap_err();
        assert_eq!(e.to_string(), "MCP error: nope");
    }

    #[test]
    fn parses_env_lines() {
        assert_eq!(parse_env("A=1\n# c\n\n B = x=y \nnoequals\n=v"), vec![("A".into(), "1".into()), ("B".into(), "x=y".into())]);
    }

    #[test]
    fn flattens_results() {
        let r = result_text(&json!({ "content": [{ "type": "resource", "resource": { "uri": "file:///a", "text": "body" } }, { "type": "resource_link", "uri": "file:///b" }] }));
        assert_eq!(r.text, "body\n[link file:///b]");
        assert_eq!(result_text(&json!({ "content": [], "structuredContent": { "n": 1 } })).text, "{\"n\":1}");
        assert!(result_text(&json!({ "content": [{ "type": "text", "text": "x".repeat(MAX_RESULT_CHARS + 5) }] })).text.ends_with("[truncated]"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_a_server_that_exits() {
        let cfg = ServerConfig { id: "x".into(), command: "sh".into(), args: vec!["-c".into(), "echo boom >&2; exit 1".into()] };
        let e = start(&cfg, &[]).await.err().unwrap().to_string();
        assert!(e.contains("stopped") && e.contains("boom"), "{e}");
    }
}
