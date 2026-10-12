//! Runs one request through the app's streaming proxy and prints its events as JSON lines.
//! Input on stdin: {"url", "method", "headers": {..}, "body"}. Used by scripts/stream-check.ts.
use app_lib::dev_proxy::{run, stream_client, Prepared};
use std::io::{Read, Write};

#[tokio::main]
async fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let v: serde_json::Value = serde_json::from_str(&input).unwrap();
    let headers = v["headers"]
        .as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect())
        .unwrap_or_default();
    let prepared = Prepared {
        url: v["url"].as_str().unwrap().to_string(),
        method: v["method"].as_str().unwrap_or("POST").to_string(),
        headers,
        body: v["body"].as_str().map(str::to_string),
        forbidden_message: None,
    };
    let (_tx, rx) = tokio::sync::oneshot::channel();
    run(&stream_client(), prepared, rx, |e| {
        let mut out = std::io::stdout().lock();
        writeln!(out, "{}", serde_json::to_string(&e).unwrap()).unwrap();
        out.flush().unwrap();
    })
    .await;
}
