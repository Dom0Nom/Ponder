//! Studio outputs: storage, file export through a native save dialog, and printing.
use crate::db::{new_id, now_ms};
use crate::error::{AppError, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudioOutput {
    #[serde(default)]
    pub id: String,
    pub space_id: String,
    pub kind: String,
    pub title: String,
    pub focus: Option<String>,
    pub data: serde_json::Value,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

const COLS: &str = "id, space_id, kind, title, focus, data, created_at, updated_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<StudioOutput> {
    let data: String = r.get(5)?;
    Ok(StudioOutput {
        id: r.get(0)?,
        space_id: r.get(1)?,
        kind: r.get(2)?,
        title: r.get(3)?,
        focus: r.get(4)?,
        data: serde_json::from_str(&data).unwrap_or(serde_json::Value::Null),
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

pub fn save(c: &Connection, o: &StudioOutput) -> AppResult<StudioOutput> {
    let mut o = o.clone();
    let now = now_ms();
    if o.id.is_empty() {
        o.id = new_id();
    }
    if o.created_at == 0 {
        o.created_at = now;
    }
    o.updated_at = now;
    c.execute(
        &format!("INSERT OR REPLACE INTO studio_outputs ({COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![o.id, o.space_id, o.kind, o.title, o.focus, o.data.to_string(), o.created_at, o.updated_at],
    )?;
    Ok(o)
}

pub fn list(c: &Connection, space_id: &str) -> AppResult<Vec<StudioOutput>> {
    let mut st = c.prepare(&format!(
        "SELECT {COLS} FROM studio_outputs WHERE space_id = ?1 ORDER BY updated_at DESC"
    ))?;
    let out = st.query_map([space_id], row)?.collect::<Result<_, _>>()?;
    Ok(out)
}

pub fn get(c: &Connection, id: &str) -> AppResult<Option<StudioOutput>> {
    Ok(c.query_row(
        &format!("SELECT {COLS} FROM studio_outputs WHERE id = ?1"),
        [id],
        row,
    )
    .optional()?)
}

pub fn delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM studio_outputs WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub async fn output_save(
    state: State<'_, AppState>,
    output: StudioOutput,
) -> AppResult<StudioOutput> {
    save(&state.db.conn()?, &output)
}

#[tauri::command]
pub async fn outputs_list(
    state: State<'_, AppState>,
    space_id: String,
) -> AppResult<Vec<StudioOutput>> {
    list(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn output_get(state: State<'_, AppState>, id: String) -> AppResult<Option<StudioOutput>> {
    get(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn output_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete(&state.db.conn()?, &id)
}

/// Keeps a suggested file name to plain characters so it can't point into another folder.
fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " .-_()".contains(c) {
                c
            } else {
                '-'
            }
        })
        .collect();
    let s = s.trim().trim_start_matches('.').to_string();
    if s.is_empty() {
        "export".into()
    } else {
        s.chars().take(120).collect()
    }
}

/// Asks the user where to save, then writes `bytes` there. The path never comes from the webview.
/// Returns the chosen path, or None when the dialog was cancelled.
#[tauri::command]
pub async fn export_file(
    window: WebviewWindow,
    name: String,
    extension: String,
    bytes: Vec<u8>,
) -> AppResult<Option<String>> {
    let ext: String = extension
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if ext.is_empty() {
        return Err(AppError::Other("missing file extension".into()));
    }
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(crate::i18n::t("native.dialog.exportFile"))
        .set_file_name(format!("{}.{ext}", safe_name(&name)))
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path
        .into_path()
        .map_err(|e| AppError::Other(e.to_string()))?;
    std::fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Opens the system print dialog for the window (macOS offers Save as PDF there).
#[tauri::command]
pub async fn print_window(window: WebviewWindow) -> AppResult<()> {
    window.print().map_err(|e| AppError::Other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};

    #[test]
    fn save_list_delete() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let s = models::create_space(
            &c,
            models::SpacePatch {
                name: Some("Bio".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let o = StudioOutput {
            id: String::new(),
            space_id: s.id.clone(),
            kind: "timeline".into(),
            title: "Cell theory".into(),
            focus: None,
            data: serde_json::json!({"events": [{"date": "1665", "title": "Hooke"}]}),
            created_at: 0,
            updated_at: 0,
        };
        let saved = save(&c, &o).unwrap();
        assert!(!saved.id.is_empty() && saved.created_at > 0);
        let edited = save(
            &c,
            &StudioOutput {
                title: "Cells".into(),
                ..saved.clone()
            },
        )
        .unwrap();
        assert_eq!(edited.created_at, saved.created_at);
        assert_eq!(list(&c, &s.id).unwrap(), vec![edited.clone()]);
        assert_eq!(
            get(&c, &saved.id).unwrap().unwrap().data["events"][0]["title"],
            "Hooke"
        );
        delete(&c, &saved.id).unwrap();
        assert!(list(&c, &s.id).unwrap().is_empty());
    }

    #[test]
    fn export_names_stay_in_the_folder() {
        assert_eq!(safe_name("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(
            safe_name("Cell theory: a timeline"),
            "Cell theory- a timeline"
        );
        assert_eq!(safe_name("..."), "export");
    }
}
