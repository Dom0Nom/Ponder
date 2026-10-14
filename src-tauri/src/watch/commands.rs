use super::{WatchService, WatchedFolder};
use crate::error::{AppError, AppResult};
use tauri::State;

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
pub async fn watch_list(
    state: State<'_, WatchService>,
    space_id: String,
) -> AppResult<Vec<WatchedFolder>> {
    let svc = state.inner().clone();
    blocking(move || svc.list(&space_id)).await
}

#[tauri::command]
pub async fn watch_add(
    state: State<'_, WatchService>,
    space_id: String,
    path: String,
    recursive: Option<bool>,
) -> AppResult<WatchedFolder> {
    let svc = state.inner().clone();
    blocking(move || svc.add(&space_id, &path, recursive.unwrap_or(true))).await
}

#[tauri::command]
pub async fn watch_remove(state: State<'_, WatchService>, id: String) -> AppResult<()> {
    let svc = state.inner().clone();
    blocking(move || svc.remove(&id)).await
}
