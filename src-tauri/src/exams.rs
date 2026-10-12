//! Saved exam simulator attempts. Questions and grading happen in the UI; this only stores them.
use crate::db::{new_id, now_ms};
use crate::error::AppResult;
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamAttempt {
    #[serde(default)]
    pub id: String,
    pub space_id: String,
    pub exam_id: String,
    pub section: String,
    pub length: String,
    pub data: serde_json::Value,
    pub score: Option<f64>,
    pub scaled: Option<i64>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub time_used_ms: i64,
}

const COLS: &str = "id, space_id, exam_id, section, length, data, score, scaled, started_at, completed_at, time_used_ms";

fn row(r: &rusqlite::Row) -> rusqlite::Result<ExamAttempt> {
    let data: String = r.get(5)?;
    Ok(ExamAttempt {
        id: r.get(0)?,
        space_id: r.get(1)?,
        exam_id: r.get(2)?,
        section: r.get(3)?,
        length: r.get(4)?,
        data: serde_json::from_str(&data).unwrap_or(serde_json::Value::Null),
        score: r.get(6)?,
        scaled: r.get(7)?,
        started_at: r.get(8)?,
        completed_at: r.get(9)?,
        time_used_ms: r.get(10)?,
    })
}

/// Inserts a new attempt (empty id) or replaces an existing one.
pub fn save(c: &Connection, a: &ExamAttempt) -> AppResult<ExamAttempt> {
    let mut a = a.clone();
    if a.id.is_empty() {
        a.id = new_id();
    }
    if a.started_at == 0 {
        a.started_at = now_ms();
    }
    c.execute(
        &format!("INSERT OR REPLACE INTO exam_attempts ({COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"),
        params![a.id, a.space_id, a.exam_id, a.section, a.length, a.data.to_string(), a.score, a.scaled, a.started_at, a.completed_at, a.time_used_ms],
    )?;
    Ok(a)
}

pub fn list(c: &Connection, space_id: &str) -> AppResult<Vec<ExamAttempt>> {
    let mut st = c.prepare(&format!("SELECT {COLS} FROM exam_attempts WHERE space_id = ?1 ORDER BY started_at DESC"))?;
    let out = st.query_map([space_id], row)?.collect::<Result<_, _>>()?;
    Ok(out)
}

pub fn get(c: &Connection, id: &str) -> AppResult<Option<ExamAttempt>> {
    Ok(c.query_row(&format!("SELECT {COLS} FROM exam_attempts WHERE id = ?1"), [id], row).optional()?)
}

pub fn delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM exam_attempts WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub async fn exam_save(state: State<'_, AppState>, attempt: ExamAttempt) -> AppResult<ExamAttempt> {
    save(&state.db.conn()?, &attempt)
}

#[tauri::command]
pub async fn exams_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<ExamAttempt>> {
    list(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn exam_get(state: State<'_, AppState>, id: String) -> AppResult<Option<ExamAttempt>> {
    get(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn exam_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete(&state.db.conn()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};

    #[test]
    fn save_update_list_delete() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let s = models::create_space(&c, models::SpacePatch { name: Some("GED".into()), ..Default::default() }).unwrap();
        let a = ExamAttempt {
            id: String::new(),
            space_id: s.id.clone(),
            exam_id: "ged".into(),
            section: "math".into(),
            length: "short".into(),
            data: serde_json::json!({"answers": [null, 2]}),
            score: None,
            scaled: None,
            started_at: 0,
            completed_at: None,
            time_used_ms: 0,
        };
        let saved = save(&c, &a).unwrap();
        assert!(!saved.id.is_empty() && saved.started_at > 0);
        let done = save(&c, &ExamAttempt { score: Some(0.75), scaled: Some(160), completed_at: Some(saved.started_at + 1), time_used_ms: 900, ..saved.clone() }).unwrap();
        let all = list(&c, &s.id).unwrap();
        assert_eq!(all, vec![done.clone()]);
        assert_eq!(get(&c, &done.id).unwrap().unwrap().data["answers"][1], 2);
        delete(&c, &done.id).unwrap();
        assert!(list(&c, &s.id).unwrap().is_empty());
    }
}
