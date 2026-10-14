use super::embed::EmbedderStatus;
use super::Ingest;
use crate::db::models::Source;
use crate::error::{AppError, AppResult};
use crate::retrieval::SearchHit;
use tauri::State;

#[tauri::command]
pub async fn import_file(
    state: State<'_, Ingest>,
    space_id: String,
    path: String,
) -> AppResult<Source> {
    state.import_file(&space_id, &path)
}

#[tauri::command]
pub async fn import_text(
    state: State<'_, Ingest>,
    space_id: String,
    title: String,
    text: String,
    kind: String,
    origin: Option<String>,
) -> AppResult<Source> {
    state.import_text(&space_id, &title, &text, &kind, origin.as_deref())
}

#[tauri::command]
pub async fn reindex_source(state: State<'_, Ingest>, id: String) -> AppResult<Source> {
    state.reindex(&id)
}

#[tauri::command]
pub async fn search_chunks(
    state: State<'_, Ingest>,
    space_id: String,
    query: String,
    limit: Option<usize>,
    source_ids: Option<Vec<String>>,
) -> AppResult<Vec<SearchHit>> {
    let ingest = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ingest.search(&space_id, &query, limit.unwrap_or(8), source_ids.as_deref())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
pub async fn embedder_status(state: State<'_, Ingest>) -> AppResult<EmbedderStatus> {
    Ok(state.embedder.status())
}

#[tauri::command]
pub async fn embedding_models() -> AppResult<Vec<super::embed::ModelSpec>> {
    Ok(super::embed::MODELS.to_vec())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEmbeddingModel {
    pub id: String,
    pub name: String,
    /// USD per million input tokens.
    pub price: Option<f64>,
}

/// Embedding models OpenRouter offers (public list, no key needed), cheapest first.
#[tauri::command]
pub async fn openrouter_embedding_models() -> AppResult<Vec<RemoteEmbeddingModel>> {
    let v: serde_json::Value = reqwest::Client::new()
        .get("https://openrouter.ai/api/v1/embeddings/models")
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut out: Vec<RemoteEmbeddingModel> = v["data"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            let price = m["pricing"]["prompt"]
                .as_str()
                .and_then(|p| p.parse::<f64>().ok())
                .map(|p| p * 1e6);
            Some(RemoteEmbeddingModel {
                name: m["name"].as_str().unwrap_or(&id).to_string(),
                id,
                price,
            })
        })
        .collect();
    out.sort_by_key(|m| m.name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub async fn set_embedding_model(state: State<'_, Ingest>, model: String) -> AppResult<()> {
    state.set_embedding_model(&model)
}

#[tauri::command]
pub async fn topic_coverage(
    state: State<'_, Ingest>,
    space_id: String,
    topics: Vec<crate::retrieval::TopicInput>,
) -> AppResult<Vec<crate::retrieval::TopicCoverage>> {
    let ingest = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ingest.coverage(&space_id, &topics))
        .await
        .map_err(|e| crate::error::AppError::Other(e.to_string()))?
}
