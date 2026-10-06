//! LAN discovery of LM Studio (:1234) and Ollama (:11434) servers.

use futures_util::stream::{self, StreamExt};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

pub const LMSTUDIO_PORT: u16 = 1234;
pub const OLLAMA_PORT: u16 = 11434;
const MAX_HOSTS: usize = 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
const CONCURRENCY: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct LanServer {
    /// lmstudio | ollama
    pub kind: &'static str,
    pub base_url: String,
    pub models: Vec<String>,
}

/// Hosts of each interface's /24, excluding the interfaces' own addresses (localhost covers those).
pub fn candidate_hosts(own: &[Ipv4Addr]) -> Vec<Ipv4Addr> {
    let usable: Vec<Ipv4Addr> = own.iter().copied().filter(|ip| !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified()).collect();
    let mut nets = BTreeSet::new();
    for ip in &usable {
        let o = ip.octets();
        nets.insert([o[0], o[1], o[2]]);
    }
    let mut out = Vec::new();
    for n in nets {
        for last in 1..=254u8 {
            let ip = Ipv4Addr::new(n[0], n[1], n[2], last);
            if !usable.contains(&ip) {
                out.push(ip);
            }
            if out.len() >= MAX_HOSTS {
                return out;
            }
        }
    }
    out
}

pub fn parse_lmstudio_models(v: &Value) -> Option<Vec<String>> {
    let data = v.get("data")?.as_array()?;
    Some(data.iter().filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string)).collect())
}

pub fn parse_ollama_tags(v: &Value) -> Option<Vec<String>> {
    let models = v.get("models")?.as_array()?;
    Some(
        models
            .iter()
            .filter_map(|m| m.get("name").or_else(|| m.get("model")).and_then(Value::as_str).map(str::to_string))
            .collect(),
    )
}

fn own_ipv4() -> Vec<Ipv4Addr> {
    if_addrs::get_if_addrs()
        .map(|ifs| {
            ifs.into_iter()
                .filter_map(|i| match i.ip() {
                    IpAddr::V4(v4) => Some(v4),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn port_open(addr: SocketAddr) -> bool {
    matches!(tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(addr)).await, Ok(Ok(_)))
}

async fn confirm(http: &reqwest::Client, host: &str, port: u16) -> Option<LanServer> {
    let (kind, probe, base) = if port == LMSTUDIO_PORT {
        ("lmstudio", format!("http://{host}:{port}/v1/models"), format!("http://{host}:{port}/v1"))
    } else {
        ("ollama", format!("http://{host}:{port}/api/tags"), format!("http://{host}:{port}/v1"))
    };
    let resp = http.get(&probe).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: Value = resp.json().await.ok()?;
    let mut models = if kind == "lmstudio" { parse_lmstudio_models(&v)? } else { parse_ollama_tags(&v)? };
    models.sort();
    Some(LanServer { kind, base_url: base, models })
}

/// Finds LM Studio and Ollama servers on localhost and each local /24.
pub async fn scan() -> Vec<LanServer> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .no_proxy()
        .build()
        .expect("http client");
    let hosts = candidate_hosts(&own_ipv4());
    let targets: Vec<SocketAddr> = hosts
        .iter()
        .flat_map(|ip| [SocketAddr::new(IpAddr::V4(*ip), LMSTUDIO_PORT), SocketAddr::new(IpAddr::V4(*ip), OLLAMA_PORT)])
        .collect();
    let open: Vec<SocketAddr> = stream::iter(targets)
        .map(|a| async move { port_open(a).await.then_some(a) })
        .buffer_unordered(CONCURRENCY)
        .filter_map(|x| async move { x })
        .collect()
        .await;

    let mut probes: Vec<(String, u16)> = vec![("localhost".into(), LMSTUDIO_PORT), ("localhost".into(), OLLAMA_PORT)];
    probes.extend(open.iter().map(|a| (a.ip().to_string(), a.port())));
    let http = &http;
    let mut found: Vec<LanServer> = stream::iter(probes)
        .map(|(h, p)| async move { confirm(http, &h, p).await })
        .buffer_unordered(16)
        .filter_map(|x| async move { x })
        .collect()
        .await;
    found.sort();
    found.dedup();
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hosts_cover_each_subnet_once() {
        let own = [Ipv4Addr::new(192, 168, 178, 20), Ipv4Addr::new(127, 0, 0, 1), Ipv4Addr::new(169, 254, 3, 4), Ipv4Addr::new(192, 168, 178, 21)];
        let hosts = candidate_hosts(&own);
        assert_eq!(hosts.len(), 252);
        assert!(hosts.contains(&Ipv4Addr::new(192, 168, 178, 37)));
        assert!(!hosts.contains(&Ipv4Addr::new(192, 168, 178, 20)));
        assert!(!hosts.iter().any(|h| h.octets()[0] == 127 || h.octets()[0] == 169));
    }

    #[test]
    fn hosts_are_capped() {
        let own: Vec<Ipv4Addr> = (0..10).map(|i| Ipv4Addr::new(10, 0, i, 5)).collect();
        assert_eq!(candidate_hosts(&own).len(), MAX_HOSTS);
    }

    #[test]
    fn parses_model_lists() {
        let lm = json!({"object": "list", "data": [{"id": "qwen3.5-9b", "object": "model"}, {"id": "text-embedding-nomic-embed-text-v1.5"}]});
        assert_eq!(parse_lmstudio_models(&lm).unwrap(), vec!["qwen3.5-9b", "text-embedding-nomic-embed-text-v1.5"]);
        let ol = json!({"models": [{"name": "llama3.2:latest", "model": "llama3.2:latest"}]});
        assert_eq!(parse_ollama_tags(&ol).unwrap(), vec!["llama3.2:latest"]);
        assert!(parse_lmstudio_models(&json!({"models": []})).is_none());
        assert!(parse_ollama_tags(&json!({"data": []})).is_none());
    }

    #[tokio::test]
    #[ignore]
    async fn live_scan_finds_dev_lmstudio() {
        let t = std::time::Instant::now();
        let found = scan().await;
        println!("scan took {:?}: {found:#?}", t.elapsed());
        assert!(found
            .iter()
            .any(|s| s.base_url == "http://192.168.1.20:1234/v1" && s.kind == "lmstudio" && s.models.iter().any(|m| m == "qwen3.5-9b")));
    }
}
