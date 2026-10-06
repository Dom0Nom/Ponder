use crate::db::models::Source;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub chunk_id: i64,
    pub source_id: String,
    pub source_title: String,
    pub text: String,
    pub start: i64,
    pub end: i64,
    pub page: Option<i64>,
    pub score: f64,
}

#[tauri::command]
pub async fn import_file(_space_id: String, _path: String) -> AppResult<Source> {
    Err(AppError::Other("not implemented".into()))
}

#[tauri::command]
pub async fn import_text(
    _space_id: String,
    _title: String,
    _text: String,
    _kind: String,
    _origin: Option<String>,
) -> AppResult<Source> {
    Err(AppError::Other("not implemented".into()))
}

#[tauri::command]
pub async fn reindex_source(_id: String) -> AppResult<Source> {
    Err(AppError::Other("not implemented".into()))
}

#[tauri::command]
pub async fn search_chunks(
    _space_id: String,
    _query: String,
    _limit: Option<usize>,
    _source_ids: Option<Vec<String>>,
) -> AppResult<Vec<SearchHit>> {
    Err(AppError::Other("not implemented".into()))
}
