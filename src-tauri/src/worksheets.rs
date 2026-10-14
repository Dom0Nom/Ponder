//! Worksheets per space. Generation, grading and layout happen in the UI; this only stores them.
use crate::db::{new_id, now_ms};
use crate::error::AppResult;
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worksheet {
    #[serde(default)]
    pub id: String,
    pub space_id: String,
    pub title: String,
    pub sheet: serde_json::Value,
    #[serde(default)]
    pub attempt: serde_json::Value,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

const COLS: &str = "id, space_id, title, data, created_at, updated_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Worksheet> {
    let data: String = r.get(3)?;
    let v: serde_json::Value = serde_json::from_str(&data).unwrap_or(serde_json::Value::Null);
    Ok(Worksheet {
        id: r.get(0)?,
        space_id: r.get(1)?,
        title: r.get(2)?,
        sheet: v.get("sheet").cloned().unwrap_or(serde_json::Value::Null),
        attempt: v.get("attempt").cloned().unwrap_or(serde_json::Value::Null),
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

/// Inserts a new worksheet (empty id) or replaces an existing one.
pub fn save(c: &Connection, w: &Worksheet) -> AppResult<Worksheet> {
    let mut w = w.clone();
    let now = now_ms();
    if w.id.is_empty() {
        w.id = new_id();
    }
    if w.created_at == 0 {
        w.created_at = now;
    }
    w.updated_at = now;
    let data = serde_json::json!({ "sheet": w.sheet, "attempt": w.attempt });
    c.execute(
        &format!("INSERT OR REPLACE INTO worksheets ({COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![w.id, w.space_id, w.title, data.to_string(), w.created_at, w.updated_at],
    )?;
    Ok(w)
}

pub fn list(c: &Connection, space_id: &str) -> AppResult<Vec<Worksheet>> {
    let mut st = c.prepare(&format!(
        "SELECT {COLS} FROM worksheets WHERE space_id = ?1 ORDER BY updated_at DESC"
    ))?;
    let out = st.query_map([space_id], row)?.collect::<Result<_, _>>()?;
    Ok(out)
}

pub fn get(c: &Connection, id: &str) -> AppResult<Option<Worksheet>> {
    Ok(c
        .query_row(&format!("SELECT {COLS} FROM worksheets WHERE id = ?1"), [id], row)
        .optional()?)
}

pub fn delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM worksheets WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub async fn worksheet_save(state: State<'_, AppState>, worksheet: Worksheet) -> AppResult<Worksheet> {
    save(&state.db.conn()?, &worksheet)
}

#[tauri::command]
pub async fn worksheets_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Worksheet>> {
    list(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn worksheet_get(state: State<'_, AppState>, id: String) -> AppResult<Option<Worksheet>> {
    get(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn worksheet_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete(&state.db.conn()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};

    fn space(c: &Connection) -> String {
        models::create_space(
            c,
            models::SpacePatch {
                name: Some("Bio".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn worksheets_save_list_get_delete() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c);
        let w = Worksheet {
            id: String::new(),
            space_id: sp.clone(),
            title: "Fotosynthese".into(),
            sheet: serde_json::json!({"tasks": [{"id": "t1", "points": 4}]}),
            attempt: serde_json::Value::Null,
            created_at: 0,
            updated_at: 0,
        };
        let saved = save(&c, &w).unwrap();
        assert!(!saved.id.is_empty() && saved.created_at > 0);
        let with_attempt = save(
            &c,
            &Worksheet {
                attempt: serde_json::json!({"responses": {"t1": [null]}}),
                ..saved.clone()
            },
        )
        .unwrap();
        assert_eq!(with_attempt.created_at, saved.created_at);
        let got = get(&c, &saved.id).unwrap().unwrap();
        assert_eq!(got.sheet["tasks"][0]["points"], 4);
        assert_eq!(got.attempt["responses"]["t1"][0], serde_json::Value::Null);
        assert_eq!(list(&c, &sp).unwrap().len(), 1);
        delete(&c, &saved.id).unwrap();
        assert!(list(&c, &sp).unwrap().is_empty());
        assert!(get(&c, &saved.id).unwrap().is_none());
    }

    #[test]
    fn worksheets_go_with_their_space() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c);
        save(
            &c,
            &Worksheet {
                id: String::new(),
                space_id: sp.clone(),
                title: "A".into(),
                sheet: serde_json::json!({}),
                attempt: serde_json::Value::Null,
                created_at: 0,
                updated_at: 0,
            },
        )
        .unwrap();
        c.execute("DELETE FROM spaces WHERE id = ?1", [&sp]).unwrap();
        assert!(list(&c, &sp).unwrap().is_empty());
    }
}
