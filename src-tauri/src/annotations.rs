//! Highlights and margin notes on a source's text, anchored by character offsets plus the quoted text.

use crate::db::{new_id, now_ms};
use crate::error::{invalid, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const MAX_QUOTE: usize = 20_000;
const MAX_NOTE: usize = 10_000;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub source_id: String,
    pub start: i64,
    pub end: i64,
    pub quote: String,
    pub note: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const COLS: &str = "id, source_id, start_offset, end_offset, quote, note, created_at, updated_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
        id: r.get(0)?,
        source_id: r.get(1)?,
        start: r.get(2)?,
        end: r.get(3)?,
        quote: r.get(4)?,
        note: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

pub fn list(c: &Connection, source_id: &str) -> AppResult<Vec<Annotation>> {
    let mut st = c.prepare(&format!(
        "SELECT {COLS} FROM annotations WHERE source_id = ?1 ORDER BY start_offset, created_at"
    ))?;
    let rows = st
        .query_map([source_id], row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn get(c: &Connection, id: &str) -> AppResult<Option<Annotation>> {
    Ok(c.query_row(
        &format!("SELECT {COLS} FROM annotations WHERE id = ?1"),
        [id],
        row,
    )
    .optional()?)
}

pub fn add(
    c: &Connection,
    source_id: &str,
    start: i64,
    end: i64,
    quote: &str,
    note: &str,
) -> AppResult<Annotation> {
    if start < 0 || end <= start {
        return Err(invalid("Select some text to highlight."));
    }
    if quote.trim().is_empty() || quote.len() > MAX_QUOTE {
        return Err(invalid("Highlights can be up to 20,000 characters."));
    }
    if note.len() > MAX_NOTE {
        return Err(invalid("Notes can be up to 10,000 characters."));
    }
    crate::db::models::get_source(c, source_id)?;
    let id = new_id();
    let now = now_ms();
    c.execute(
        &format!("INSERT INTO annotations ({COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)"),
        params![id, source_id, start, end, quote, note, now],
    )?;
    Ok(get(c, &id)?.expect("just inserted"))
}

pub fn update(c: &Connection, id: &str, start: i64, end: i64, note: &str) -> AppResult<Annotation> {
    if start < 0 || end <= start {
        return Err(invalid("Select some text to highlight."));
    }
    if note.len() > MAX_NOTE {
        return Err(invalid("Notes can be up to 10,000 characters."));
    }
    let n = c.execute(
        "UPDATE annotations SET start_offset = ?2, end_offset = ?3, note = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, start, end, note, now_ms()],
    )?;
    if n == 0 {
        return Err(crate::error::AppError::NotFound(
            "This highlight no longer exists.".into(),
        ));
    }
    Ok(get(c, id)?.expect("just updated"))
}

pub fn delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub async fn annotations_list(
    state: State<'_, AppState>,
    source_id: String,
) -> AppResult<Vec<Annotation>> {
    list(&state.db.conn()?, &source_id)
}

#[tauri::command]
pub async fn annotation_add(
    state: State<'_, AppState>,
    source_id: String,
    start: i64,
    end: i64,
    quote: String,
    note: Option<String>,
) -> AppResult<Annotation> {
    add(
        &state.db.conn()?,
        &source_id,
        start,
        end,
        &quote,
        note.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
pub async fn annotation_update(
    state: State<'_, AppState>,
    id: String,
    start: i64,
    end: i64,
    note: String,
) -> AppResult<Annotation> {
    update(&state.db.conn()?, &id, start, end, &note)
}

#[tauri::command]
pub async fn annotation_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete(&state.db.conn()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn add_update_list_and_cascade() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let space = crate::db::models::create_space(
            &c,
            crate::db::models::SpacePatch {
                name: Some("S".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let src = crate::db::models::insert_source(&c, &space.id, "Doc", "text", None).unwrap();
        assert!(add(&c, &src.id, 5, 5, "x", "").is_err());
        assert!(add(&c, "missing", 0, 4, "abcd", "").is_err());
        let b = add(&c, &src.id, 10, 20, "second one", "").unwrap();
        let a = add(&c, &src.id, 0, 4, "abcd", "why").unwrap();
        assert_eq!(
            list(&c, &src.id)
                .unwrap()
                .iter()
                .map(|x| x.id.clone())
                .collect::<Vec<_>>(),
            vec![a.id.clone(), b.id.clone()]
        );
        let u = update(&c, &a.id, 1, 5, "because").unwrap();
        assert_eq!((u.start, u.end, u.note.as_str()), (1, 5, "because"));
        assert!(update(&c, "nope", 0, 1, "").is_err());
        delete(&c, &b.id).unwrap();
        assert_eq!(list(&c, &src.id).unwrap().len(), 1);
        crate::db::models::delete_source(&c, &src.id).unwrap();
        assert!(list(&c, &src.id).unwrap().is_empty());
    }
}
