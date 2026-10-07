//! Site icons: resolves a website's logo from its homepage, caches it on disk and returns a data URL.

use crate::error::AppResult;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_BYTES: usize = 512 * 1024;
const TTL: u64 = 30 * 24 * 3600;
const NEGATIVE_TTL: u64 = 24 * 3600;
const INDEX_FILE: &str = "index.json";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_LINK_TRIES: usize = 4;
const FALLBACK_PATHS: [&str; 3] = ["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png"];

#[derive(Debug, Clone, PartialEq)]
pub struct Icon {
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    fetched_at: u64,
    /// File extension of the cached icon; `None` records a miss.
    ext: Option<String>,
}

type Index = HashMap<String, Entry>;

static INDEX_LOCK: Mutex<()> = Mutex::new(());
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .redirect(reqwest::redirect::Policy::limited(5))
            .timeout(Duration::from_secs(8))
            .build()
            .expect("http client")
    })
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Lowercased hostname from a bare host or a URL. `None` for IPs, localhost and single-label names.
pub fn normalize_host(input: &str) -> Option<String> {
    let s = input.trim();
    let with_scheme = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    let host = url::Url::parse(&with_scheme).ok()?.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if host.parse::<IpAddr>().is_ok() || host.starts_with('[') {
        return None;
    }
    let local = host == "localhost" || !host.contains('.') || host.ends_with(".local") || host.ends_with(".lan") || host.ends_with(".internal");
    let valid = host.split('.').all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    (!local && valid).then_some(host)
}

/// Registrable domain by a simple heuristic: last two labels, or three under `co.uk`-style suffixes.
pub fn root_domain(host: &str) -> String {
    let labels: Vec<&str> = host.split('.').collect();
    let n = labels.len();
    if n <= 2 {
        return host.to_string();
    }
    let second_level = matches!(labels[n - 2], "co" | "com" | "org" | "net" | "gov" | "edu" | "ac" | "or" | "ne") && labels[n - 1].len() == 2;
    let keep = if second_level { 3 } else { 2 };
    labels[n - keep.min(n)..].join(".")
}

/// Hosts to try, best first: root domain, `www.` root, then the host itself.
pub fn candidate_hosts(host: &str) -> Vec<String> {
    let root = root_domain(host);
    let mut out = vec![root.clone(), format!("www.{root}")];
    if !out.iter().any(|h| h == host) {
        out.push(host.to_string());
    }
    out
}

fn sniff(mime: &str, b: &[u8]) -> Option<&'static str> {
    match mime {
        "image/svg+xml" => std::str::from_utf8(b).ok().filter(|s| s.contains("<svg")).map(|_| "image/svg+xml"),
        "image/png" => b.starts_with(&[0x89, b'P', b'N', b'G']).then_some("image/png"),
        "image/jpeg" | "image/jpg" => b.starts_with(&[0xFF, 0xD8]).then_some("image/jpeg"),
        "image/webp" => (b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP").then_some("image/webp"),
        "image/x-icon" | "image/vnd.microsoft.icon" | "image/ico" => b.starts_with(&[0, 0, 1, 0]).then_some("image/x-icon"),
        _ => None,
    }
}

/// Body up to `MAX_BYTES` with its content type and final URL; `None` when larger or the request fails.
async fn get_capped(url: &str) -> Option<(Vec<u8>, String, String)> {
    let mut resp = client().get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let final_url = resp.url().to_string();
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.ok()? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BYTES {
            return None;
        }
    }
    Some((body, ctype, final_url))
}

async fn fetch_icon(url: &str) -> Option<Icon> {
    let (bytes, ctype, _) = get_capped(url).await?;
    let mime = sniff(&ctype, &bytes)?;
    Some(Icon { mime, bytes })
}

#[derive(Debug, PartialEq)]
struct Link {
    href: String,
    score: u32,
}

fn parse_size(sizes: &str) -> u32 {
    sizes
        .split_whitespace()
        .filter_map(|s| s.to_ascii_lowercase().split_once('x').and_then(|(w, _)| w.parse::<u32>().ok()))
        .max()
        .unwrap_or(0)
}

/// Icon links of a page ranked best first: SVG, mask icons, then raster by size (>= 32px preferred).
fn parse_links(html: &str, base: &str) -> Vec<Link> {
    let Ok(base) = url::Url::parse(base) else { return vec![] };
    let doc = scraper::Html::parse_document(html);
    let sel = scraper::Selector::parse("link[rel][href]").unwrap();
    let mut out: Vec<Link> = vec![];
    for el in doc.select(&sel) {
        let rel = el.value().attr("rel").unwrap_or("").to_ascii_lowercase();
        let rels: Vec<&str> = rel.split_whitespace().collect();
        let apple = rels.contains(&"apple-touch-icon") || rels.contains(&"apple-touch-icon-precomposed");
        let mask = rels.contains(&"mask-icon");
        let icon = rels.contains(&"icon");
        if !(apple || mask || icon) {
            continue;
        }
        let raw = el.value().attr("href").unwrap_or("").trim();
        if raw.is_empty() || raw.starts_with("data:") {
            continue;
        }
        let Ok(href) = base.join(raw) else { continue };
        if !matches!(href.scheme(), "http" | "https") {
            continue;
        }
        let ty = el.value().attr("type").unwrap_or("").to_ascii_lowercase();
        let path = href.path().to_ascii_lowercase();
        let svg = ty.contains("svg") || path.ends_with(".svg");
        let ico = (ty.contains("icon") && !ty.contains("svg")) || path.ends_with(".ico");
        let size = parse_size(el.value().attr("sizes").unwrap_or(""));
        let score = if mask {
            500
        } else if svg {
            1000
        } else if ico {
            1
        } else if apple {
            if size > 0 {
                size
            } else {
                180
            }
        } else if size == 0 {
            32
        } else if size >= 32 {
            size
        } else {
            2
        };
        out.push(Link { href: href.to_string(), score });
    }
    out.sort_by(|a, b| b.score.cmp(&a.score));
    let mut seen = std::collections::HashSet::new();
    out.retain(|l| seen.insert(l.href.clone()));
    out
}

/// Best icon of a site given its origin (e.g. `https://kimi.ai`).
pub async fn fetch_best(origin: &str) -> Option<Icon> {
    let mut urls: Vec<String> = vec![];
    if let Some((body, ctype, final_url)) = get_capped(&format!("{origin}/")).await {
        if ctype.contains("html") {
            let html = String::from_utf8_lossy(&body);
            urls.extend(parse_links(&html, &final_url).into_iter().take(MAX_LINK_TRIES).map(|l| l.href));
        }
    }
    for p in FALLBACK_PATHS {
        let u = format!("{origin}{p}");
        if !urls.contains(&u) {
            urls.push(u);
        }
    }
    for u in urls {
        if let Some(icon) = fetch_icon(&u).await {
            return Some(icon);
        }
    }
    None
}

fn ext_of(mime: &str) -> &'static str {
    match mime {
        "image/svg+xml" => "svg",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "ico",
    }
}

fn mime_of(ext: &str) -> &'static str {
    match ext {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/x-icon",
    }
}

fn read_index(dir: &Path) -> Index {
    std::fs::read(dir.join(INDEX_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn data_url(icon: &Icon) -> String {
    format!("data:{};base64,{}", icon.mime, base64::engine::general_purpose::STANDARD.encode(&icon.bytes))
}

enum Cached {
    Hit(Icon),
    Miss,
    Stale,
}

fn lookup_cache(dir: &Path, host: &str, now: u64) -> Cached {
    let _g = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Some(e) = read_index(dir).get(host).cloned() else { return Cached::Stale };
    let age = now.saturating_sub(e.fetched_at);
    match e.ext {
        None if age < NEGATIVE_TTL => Cached::Miss,
        Some(ext) if age < TTL => match std::fs::read(dir.join(format!("{host}.{ext}"))) {
            Ok(bytes) => Cached::Hit(Icon { mime: mime_of(&ext), bytes }),
            Err(_) => Cached::Stale,
        },
        _ => Cached::Stale,
    }
}

fn store(dir: &Path, host: &str, icon: Option<&Icon>, now: u64) {
    let _g = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut idx = read_index(dir);
    let ext = icon.and_then(|i| {
        let ext = ext_of(i.mime);
        std::fs::write(dir.join(format!("{host}.{ext}")), &i.bytes).ok().map(|_| ext.to_string())
    });
    idx.insert(host.to_string(), Entry { fetched_at: now, ext });
    if let Ok(b) = serde_json::to_vec(&idx) {
        let _ = std::fs::write(dir.join(INDEX_FILE), b);
    }
}

/// Cached lookup that falls back to trying each origin in order.
async fn resolve(dir: &Path, host: &str, origins: Vec<String>, now: u64) -> Option<Icon> {
    let icons = dir.join("icons");
    let _ = std::fs::create_dir_all(&icons);
    match lookup_cache(&icons, host, now) {
        Cached::Hit(i) => return Some(i),
        Cached::Miss => return None,
        Cached::Stale => {}
    }
    let mut found = None;
    for o in origins {
        if let Some(i) = fetch_best(&o).await {
            found = Some(i);
            break;
        }
    }
    store(&icons, host, found.as_ref(), now);
    found
}

/// Data URL of the site's icon, or `None` when the input is not a public hostname or no icon exists.
pub async fn site_icon(dir: &Path, host_or_url: &str) -> AppResult<Option<String>> {
    let Some(host) = normalize_host(host_or_url) else { return Ok(None) };
    let origins = candidate_hosts(&host).into_iter().map(|h| format!("https://{h}")).collect();
    Ok(resolve(dir, &host, origins, now_secs()).await.map(|i| data_url(&i)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>"##;
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 13, 10, 26, 10, 0, 0];

    fn html(body: &str) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_raw(body.as_bytes().to_vec(), "text/html; charset=utf-8")
    }
    fn svg() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_raw(SVG.as_bytes().to_vec(), "image/svg+xml")
    }
    fn png() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_raw(PNG.to_vec(), "image/png")
    }

    #[test]
    fn hosts() {
        assert_eq!(normalize_host("https://API.Kimi.ai/coding/v1").as_deref(), Some("api.kimi.ai"));
        assert_eq!(normalize_host("kimi.ai").as_deref(), Some("kimi.ai"));
        for bad in ["http://192.168.1.20:1234/v1", "localhost:11434", "http://[::1]:8080", "mybox", "foo.local"] {
            assert_eq!(normalize_host(bad), None, "{bad}");
        }
        assert_eq!(root_domain("api.kimi.ai"), "kimi.ai");
        assert_eq!(root_domain("api.example.co.uk"), "example.co.uk");
        assert_eq!(candidate_hosts("api.kimi.ai"), vec!["kimi.ai", "www.kimi.ai", "api.kimi.ai"]);
        assert_eq!(candidate_hosts("kimi.ai"), vec!["kimi.ai", "www.kimi.ai"]);
    }

    #[test]
    fn link_ranking() {
        let page = r#"<head>
          <link rel="icon" href="/a16.png" sizes="16x16" type="image/png">
          <link rel="shortcut icon" href="/favicon.ico">
          <link rel="icon" href="/a64.png" sizes="64x64">
          <link rel="apple-touch-icon" href="/touch.png">
          <link rel="mask-icon" href="/mask.svg">
          <link rel="icon" href="//cdn.test/logo.svg" type="image/svg+xml">
          <link rel="stylesheet" href="/x.css">
          <link rel="icon" href="data:image/png;base64,AAAA">
        </head>"#;
        let hrefs: Vec<String> = parse_links(page, "https://site.test/home/").into_iter().map(|l| l.href).collect();
        assert_eq!(
            hrefs,
            vec![
                "https://cdn.test/logo.svg",
                "https://site.test/mask.svg",
                "https://site.test/touch.png",
                "https://site.test/a64.png",
                "https://site.test/a16.png",
                "https://site.test/favicon.ico",
            ]
        );
    }

    #[tokio::test]
    async fn prefers_svg_link_over_png() {
        let s = MockServer::start().await;
        Mock::given(path("/")).respond_with(html(r#"<link rel="icon" href="/big.png" sizes="128x128"><link rel="icon" href="/m.svg" type="image/svg+xml">"#)).mount(&s).await;
        Mock::given(path("/big.png")).respond_with(png()).mount(&s).await;
        Mock::given(path("/m.svg")).respond_with(svg()).mount(&s).await;
        assert_eq!(fetch_best(&s.uri()).await.unwrap().mime, "image/svg+xml");
    }

    #[tokio::test]
    async fn falls_back_to_well_known_paths() {
        let s = MockServer::start().await;
        Mock::given(path("/")).respond_with(html("<html>no links</html>")).mount(&s).await;
        Mock::given(path("/favicon.svg")).respond_with(ResponseTemplate::new(404)).mount(&s).await;
        Mock::given(path("/favicon.ico")).respond_with(ResponseTemplate::new(200).set_body_raw(vec![0, 0, 1, 0, 1, 0], "image/x-icon")).mount(&s).await;
        assert_eq!(fetch_best(&s.uri()).await.unwrap().mime, "image/x-icon");
    }

    #[tokio::test]
    async fn skips_broken_link_and_uses_next() {
        let s = MockServer::start().await;
        Mock::given(path("/")).respond_with(html(r#"<link rel="icon" href="/gone.svg" type="image/svg+xml"><link rel="icon" href="/ok.png" sizes="64x64">"#)).mount(&s).await;
        Mock::given(path("/gone.svg")).respond_with(ResponseTemplate::new(404)).mount(&s).await;
        Mock::given(path("/ok.png")).respond_with(png()).mount(&s).await;
        assert_eq!(fetch_best(&s.uri()).await.unwrap().mime, "image/png");
    }

    #[tokio::test]
    async fn rejects_oversize_and_wrong_content_type() {
        let s = MockServer::start().await;
        Mock::given(path("/")).respond_with(html(r#"<link rel="icon" href="/huge.png"><link rel="icon" href="/page.png" sizes="64x64">"#)).mount(&s).await;
        let mut big = PNG.to_vec();
        big.resize(MAX_BYTES + 10, 0);
        Mock::given(path("/huge.png")).respond_with(ResponseTemplate::new(200).set_body_raw(big, "image/png")).mount(&s).await;
        Mock::given(path("/page.png")).respond_with(html("<html>soft 404</html>")).mount(&s).await;
        Mock::given(path("/favicon.svg")).respond_with(ResponseTemplate::new(200).set_body_raw(SVG.as_bytes().to_vec(), "text/plain")).mount(&s).await;
        assert!(fetch_best(&s.uri()).await.is_none());
    }

    #[tokio::test]
    async fn rejects_mismatched_bytes() {
        let s = MockServer::start().await;
        Mock::given(path("/")).respond_with(ResponseTemplate::new(404)).mount(&s).await;
        Mock::given(path("/favicon.svg")).respond_with(ResponseTemplate::new(200).set_body_raw(b"<html>nope</html>".to_vec(), "image/svg+xml")).mount(&s).await;
        assert!(fetch_best(&s.uri()).await.is_none());
    }

    #[tokio::test]
    async fn follows_redirects() {
        let s = MockServer::start().await;
        Mock::given(path("/")).respond_with(ResponseTemplate::new(301).insert_header("location", "/home/")).mount(&s).await;
        Mock::given(path("/home/")).respond_with(html(r#"<link rel="icon" href="logo.svg">"#)).mount(&s).await;
        Mock::given(path("/home/logo.svg")).respond_with(svg()).mount(&s).await;
        assert_eq!(fetch_best(&s.uri()).await.unwrap().mime, "image/svg+xml");
    }

    #[tokio::test]
    async fn caches_hits_and_misses() {
        let dir = tempfile::tempdir().unwrap();
        let s = MockServer::start().await;
        Mock::given(method("GET")).and(path("/")).respond_with(html(r#"<link rel="icon" href="/m.svg">"#)).expect(1).mount(&s).await;
        Mock::given(path("/m.svg")).respond_with(svg()).mount(&s).await;
        let now = 1_000_000;
        let a = resolve(dir.path(), "a.test", vec![s.uri()], now).await.unwrap();
        let b = resolve(dir.path(), "a.test", vec![s.uri()], now + 10).await.unwrap();
        assert_eq!(a, b);
        assert!(dir.path().join("icons/a.test.svg").exists());
        assert!(matches!(lookup_cache(&dir.path().join("icons"), "a.test", now + TTL), Cached::Stale));

        let dead = MockServer::start().await;
        Mock::given(method("GET")).respond_with(ResponseTemplate::new(404)).mount(&dead).await;
        assert!(resolve(dir.path(), "b.test", vec![dead.uri()], now).await.is_none());
        let seen = dead.received_requests().await.unwrap().len();
        assert!(resolve(dir.path(), "b.test", vec![dead.uri()], now + NEGATIVE_TTL - 1).await.is_none());
        assert_eq!(dead.received_requests().await.unwrap().len(), seen);
        assert!(resolve(dir.path(), "b.test", vec![dead.uri()], now + NEGATIVE_TTL).await.is_none());
        assert!(dead.received_requests().await.unwrap().len() > seen);
    }

    #[tokio::test]
    async fn no_credentials_sent() {
        let s = MockServer::start().await;
        Mock::given(path("/")).respond_with(ResponseTemplate::new(404)).mount(&s).await;
        let _ = fetch_best(&s.uri()).await;
        for r in s.received_requests().await.unwrap() {
            assert!(r.headers.get("authorization").is_none() && r.headers.get("cookie").is_none());
        }
    }

    #[tokio::test]
    #[ignore = "network"]
    async fn live_kimi() {
        let dir = tempfile::tempdir().unwrap();
        let url = site_icon(dir.path(), "https://api.kimi.ai/coding/v1").await.unwrap();
        assert!(url.unwrap().starts_with("data:image/"));
    }

    /// `ICON_DOMAINS` = JSON {name: domain}; writes each icon to `ICON_OUT/<name>.<ext>` and prints misses.
    #[tokio::test]
    #[ignore = "network"]
    async fn live_dump() {
        let (Ok(file), Ok(out)) = (std::env::var("ICON_DOMAINS"), std::env::var("ICON_OUT")) else { return };
        let map: std::collections::BTreeMap<String, String> = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        for (name, domain) in map {
            match site_icon(dir.path(), &domain).await.unwrap() {
                Some(url) => {
                    let (head, b64) = url.split_once(',').unwrap();
                    let ext = ext_of(head.trim_start_matches("data:").trim_end_matches(";base64"));
                    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
                    std::fs::write(std::path::Path::new(&out).join(format!("{name}.{ext}")), bytes).unwrap();
                    println!("OK   {name} <- {domain} ({ext})");
                }
                None => println!("MISS {name} <- {domain}"),
            }
        }
    }
}
