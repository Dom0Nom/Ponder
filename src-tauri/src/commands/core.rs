use crate::db::models::{self as m, *};
use crate::error::AppResult;
use crate::AppState;
use rusqlite::OptionalExtension;
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
    let c = state.db.conn()?;
    let local: Option<String> = c
        .query_row("SELECT local_path FROM sources WHERE id=?1", [&id], |r| r.get(0))
        .optional()?
        .flatten();
    m::delete_source(&c, &id)?;
    if let Some(dir) = local.as_deref().and_then(|p| std::path::Path::new(p).parent()) {
        // cloud downloads live in <data>/imports/<uuid>/; never touch anything else
        if dir.parent() == Some(state.data_dir.join("imports").as_path()) {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_source_text(state: State<'_, AppState>, id: String) -> AppResult<SourceText> {
    m::get_source_text(&state.db.conn()?, &id)
}

/// Where the original PDF of a source is on disk: the kept copy, else the imported file if it's still there.
pub fn original_pdf(c: &rusqlite::Connection, id: &str) -> AppResult<std::path::PathBuf> {
    let (kind, origin, local): (String, Option<String>, Option<String>) =
        c.query_row("SELECT kind, origin, local_path FROM sources WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?
            .ok_or_else(|| crate::error::AppError::NotFound("Source".into()))?;
    if kind != "pdf" {
        return Err(crate::error::invalid("Only PDFs have a page view."));
    }
    [local, origin]
        .into_iter()
        .flatten()
        .map(std::path::PathBuf::from)
        .find(|p| p.is_absolute() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) && p.is_file())
        .ok_or_else(|| crate::error::AppError::NotFound("The original PDF".into()))
}

#[tauri::command]
pub async fn source_pdf(state: State<'_, AppState>, id: String) -> AppResult<tauri::ipc::Response> {
    let path = original_pdf(&state.db.conn()?, &id)?;
    let bytes = tokio::fs::read(&path).await?;
    Ok(tauri::ipc::Response::new(bytes))
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
    if key.starts_with("backup.") {
        return Err(crate::error::invalid("Backup settings change through the Backups section."));
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn finds_the_original_pdf() {
        let (db, dir) = test_db();
        let c = db.conn().unwrap();
        let sp = m::create_space(&c, SpacePatch { name: Some("S".into()), ..Default::default() }).unwrap();
        let file = dir.path().join("a.pdf");
        std::fs::write(&file, b"%PDF-1.4").unwrap();
        let pdf = m::insert_source(&c, &sp.id, "A", "pdf", Some(file.to_str().unwrap())).unwrap();
        assert_eq!(original_pdf(&c, &pdf.id).unwrap(), file);
        let gone = m::insert_source(&c, &sp.id, "B", "pdf", Some("/nowhere/b.pdf")).unwrap();
        assert_eq!(original_pdf(&c, &gone.id).unwrap_err().code(), "not_found");
        let web = m::insert_source(&c, &sp.id, "C", "url", Some("https://a.example")).unwrap();
        assert_eq!(original_pdf(&c, &web.id).unwrap_err().code(), "invalid");
    }
}
