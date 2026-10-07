//! OpenRouter's public model catalog, cached in the app data dir so the picker works offline.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const URL: &str = "https://openrouter.ai/api/v1/models";
const CACHE_FILE: &str = "openrouter-models.json";
const TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterModel {
    pub id: String,
    pub name: String,
    pub context_length: Option<u64>,
    pub supported_parameters: Vec<String>,
    pub created: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterCatalog {
    pub fetched_at: u64,
    pub models: Vec<OpenRouterModel>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn parse(body: &str) -> AppResult<Vec<OpenRouterModel>> {
    let v: Value = serde_json::from_str(body)?;
    let data = v.get("data").and_then(Value::as_array).ok_or_else(|| AppError::Other("Unexpected OpenRouter response".into()))?;
    let mut out: Vec<OpenRouterModel> = data
        .iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            let name = m.get("name").and_then(Value::as_str).unwrap_or(&id).to_string();
            let supported_parameters = m
                .get("supported_parameters")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            Some(OpenRouterModel {
                id,
                name,
                context_length: m.get("context_length").and_then(Value::as_u64),
                supported_parameters,
                created: m.get("created").and_then(Value::as_u64),
            })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn read_cache(dir: &Path) -> Option<OpenRouterCatalog> {
    serde_json::from_slice(&std::fs::read(dir.join(CACHE_FILE)).ok()?).ok()
}

fn is_fresh(c: &OpenRouterCatalog, now: u64) -> bool {
    now.saturating_sub(c.fetched_at) < TTL.as_secs()
}

async fn fetch(http: &reqwest::Client, url: &str) -> AppResult<Vec<OpenRouterModel>> {
    let resp = http.get(url).header("Accept", "application/json").send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("OpenRouter answered {}", resp.status().as_u16())));
    }
    parse(&resp.text().await?)
}

/// Cached list when fresh; otherwise fetch, and fall back to a stale cache if the network fails.
pub async fn load(http: &reqwest::Client, dir: &Path, force: bool) -> AppResult<OpenRouterCatalog> {
    load_from(http, URL, dir, force).await
}

async fn load_from(http: &reqwest::Client, url: &str, dir: &Path, force: bool) -> AppResult<OpenRouterCatalog> {
    let cached = read_cache(dir);
    if let Some(c) = &cached {
        if !force && is_fresh(c, now_secs()) {
            return Ok(c.clone());
        }
    }
    match fetch(http, url).await {
        Ok(models) => {
            let c = OpenRouterCatalog { fetched_at: now_secs(), models };
            if let Ok(bytes) = serde_json::to_vec(&c) {
                let _ = std::fs::write(dir.join(CACHE_FILE), bytes);
            }
            Ok(c)
        }
        Err(e) => cached.ok_or(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const BODY: &str = r#"{"data":[
      {"id":"openai/gpt-5","name":"OpenAI: GPT-5","context_length":400000,"created":1,"supported_parameters":["temperature","reasoning"]},
      {"id":"anthropic/claude-haiku-4.5","context_length":200000,"supported_parameters":["reasoning","include_reasoning"]},
      {"name":"no id"}]}"#;

    #[test]
    fn parses_and_skips_bad_rows() {
        let m = parse(BODY).unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].id, "anthropic/claude-haiku-4.5");
        assert_eq!(m[0].name, "anthropic/claude-haiku-4.5");
        assert_eq!(m[1].supported_parameters, vec!["temperature", "reasoning"]);
        assert!(parse("{}").is_err());
    }

    #[test]
    fn freshness_uses_ttl() {
        let c = OpenRouterCatalog { fetched_at: 1000, models: vec![] };
        assert!(is_fresh(&c, 1000 + TTL.as_secs() - 1));
        assert!(!is_fresh(&c, 1000 + TTL.as_secs()));
    }

    #[tokio::test]
    async fn caches_then_falls_back_to_stale() {
        let dir = tempfile::tempdir().unwrap();
        let server = MockServer::start().await;
        Mock::given(method("GET")).respond_with(ResponseTemplate::new(200).set_body_string(BODY)).up_to_n_times(2).mount(&server).await;
        Mock::given(method("GET")).respond_with(ResponseTemplate::new(500)).mount(&server).await;
        let http = reqwest::Client::new();
        let first = load_from(&http, &server.uri(), dir.path(), false).await.unwrap();
        assert_eq!(first.models.len(), 2);
        let again = load_from(&http, &server.uri(), dir.path(), false).await.unwrap();
        assert_eq!(again.fetched_at, first.fetched_at);
        let forced = load_from(&http, &server.uri(), dir.path(), true).await.unwrap();
        assert_eq!(forced.models.len(), 2);
        let failing = load_from(&http, &server.uri(), dir.path(), true).await.unwrap();
        assert_eq!(failing.models.len(), 2);
        let empty = tempfile::tempdir().unwrap();
        assert!(load_from(&http, &server.uri(), empty.path(), false).await.is_err());
    }
}
