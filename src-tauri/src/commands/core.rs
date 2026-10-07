use crate::db::models::{self as m, *};
use crate::error::AppResult;
use crate::AppState;
use serde_json::Value;
use tauri::State;

// Commands are async so they run on the runtime pool, never on the main (UI) thread.

#[tauri::command]
pub async fn list_spaces(state: State<'_, AppState>) -> AppResult<Vec<Space>> {
    m::list_spaces(&state.db.conn()?)
}

#[tauri::command]
pub async fn get_space(state: State<'_, AppState>, id: String) -> AppResult<Space> {
    m::get_space(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn create_space(state: State<'_, AppState>, input: SpacePatch) -> AppResult<Space> {
    m::create_space(&state.db.conn()?, input)
}

#[tauri::command]
pub async fn update_space(state: State<'_, AppState>, id: String, patch: SpacePatch) -> AppResult<Space> {
    m::update_space(&state.db.conn()?, &id, patch)
}

#[tauri::command]
pub async fn touch_space(state: State<'_, AppState>, id: String) -> AppResult<()> {
    m::touch_space(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn delete_space(state: State<'_, AppState>, id: String) -> AppResult<()> {
    m::delete_space(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn list_sources(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Source>> {
    m::list_sources(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn get_source(state: State<'_, AppState>, id: String) -> AppResult<Source> {
    m::get_source(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn update_source(state: State<'_, AppState>, id: String, patch: SourcePatch) -> AppResult<Source> {
    m::update_source(&state.db.conn()?, &id, patch)
}

#[tauri::command]
pub async fn delete_source(state: State<'_, AppState>, id: String) -> AppResult<()> {
    m::delete_source(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn get_source_text(state: State<'_, AppState>, id: String) -> AppResult<SourceText> {
    m::get_source_text(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn list_threads(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Thread>> {
    m::list_threads(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn create_thread(state: State<'_, AppState>, space_id: String, title: Option<String>) -> AppResult<Thread> {
    m::create_thread(&state.db.conn()?, &space_id, title)
}

#[tauri::command]
pub async fn rename_thread(state: State<'_, AppState>, id: String, title: String) -> AppResult<Thread> {
    m::rename_thread(&state.db.conn()?, &id, &title)
}

#[tauri::command]
pub async fn pin_thread(state: State<'_, AppState>, id: String, pinned: bool) -> AppResult<Thread> {
    m::set_thread_pinned(&state.db.conn()?, &id, pinned)
}

#[tauri::command]
pub async fn delete_thread(state: State<'_, AppState>, id: String) -> AppResult<()> {
    m::delete_thread(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn list_messages(state: State<'_, AppState>, thread_id: String) -> AppResult<Vec<Message>> {
    m::list_messages(&state.db.conn()?, &thread_id)
}

#[tauri::command]
pub async fn add_message(state: State<'_, AppState>, message: NewMessage) -> AppResult<Message> {
    m::add_message(&state.db.conn()?, message)
}

#[tauri::command]
pub async fn update_message(state: State<'_, AppState>, id: String, patch: MessagePatch) -> AppResult<Message> {
    m::update_message(&state.db.conn()?, &id, patch)
}

#[tauri::command]
pub async fn delete_message(state: State<'_, AppState>, id: String) -> AppResult<()> {
    m::delete_message(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn list_journal(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<JournalEntry>> {
    m::list_journal(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn add_journal(
    state: State<'_, AppState>,
    space_id: String,
    kind: String,
    title: String,
    content: String,
) -> AppResult<JournalEntry> {
    m::add_journal(&state.db.conn()?, &space_id, &kind, &title, &content)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<serde_json::Map<String, Value>> {
    m::get_settings(&state.db.conn()?)
}

#[tauri::command]
pub async fn set_setting(state: State<'_, AppState>, key: String, value: Value) -> AppResult<()> {
    m::set_setting(&state.db.conn()?, &key, &value)
}

#[tauri::command]
pub async fn list_memory(state: State<'_, AppState>) -> AppResult<Vec<MemoryItem>> {
    m::list_memory(&state.db.conn()?)
}

#[tauri::command]
pub async fn add_memory(
    state: State<'_, AppState>,
    text: String,
    origin: String,
    space_id: Option<String>,
) -> AppResult<MemoryItem> {
    m::add_memory(&state.db.conn()?, &text, &origin, space_id.as_deref())
}

#[tauri::command]
pub async fn update_memory(state: State<'_, AppState>, id: String, text: String) -> AppResult<MemoryItem> {
    m::update_memory(&state.db.conn()?, &id, &text)
}

#[tauri::command]
pub async fn delete_memory(state: State<'_, AppState>, id: String) -> AppResult<()> {
    m::delete_memory(&state.db.conn()?, &id)
}
