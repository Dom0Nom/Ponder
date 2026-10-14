//! "Where do I start?" micro-steps: a short checklist per space (or one for the no-space case).
//! Generation happens in the UI; this module stores the current list and its progress.
use crate::db::{new_id, now_ms};
use crate::error::{invalid, AppError, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

const MAX_STEPS: usize = 12;
const MAX_TEXT: usize = 300;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MicroStep {
    pub id: String,
    pub space_id: Option<String>,
    pub session_id: Option<String>,
    pub goal: Option<String>,
    pub text: String,
    pub minutes: i64,
    pub done: bool,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewMicroStep {
    pub text: String,
    pub minutes: i64,
}

const COLS: &str = "id, space_id, session_id, goal, text, minutes, done, position, created_at";

fn row(r: &Row) -> rusqlite::Result<MicroStep> {
    Ok(MicroStep {
        id: r.get(0)?,
        space_id: r.get(1)?,
        session_id: r.get(2)?,
        goal: r.get(3)?,
        text: r.get(4)?,
        minutes: r.get(5)?,
        done: r.get::<_, i64>(6)? != 0,
        position: r.get(7)?,
        created_at: r.get(8)?,
    })
}

fn clean_text(t: &str) -> AppResult<String> {
    let t = t.trim();
    if t.is_empty() {
        return Err(invalid("A step needs some text"));
    }
    Ok(t.chars().take(MAX_TEXT).collect())
}

fn clamp_minutes(m: i64) -> i64 {
    m.clamp(2, 5)
}

fn not_found() -> AppError {
    AppError::NotFound("step".into())
}

pub fn list_steps(c: &Connection, space_id: Option<&str>) -> AppResult<Vec<MicroStep>> {
    let mut st = c.prepare(&format!(
        "SELECT {COLS} FROM micro_steps WHERE space_id IS ?1 ORDER BY position"
    ))?;
    let rows = st.query_map(params![space_id], row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn get_step(c: &Connection, id: &str) -> AppResult<MicroStep> {
    c.query_row(
        &format!("SELECT {COLS} FROM micro_steps WHERE id = ?1"),
        params![id],
        row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => not_found(),
        e => e.into(),
    })
}

pub fn replace_steps(
    c: &Connection,
    space_id: Option<&str>,
    session_id: Option<&str>,
    goal: Option<&str>,
    steps: &[NewMicroStep],
) -> AppResult<Vec<MicroStep>> {
    let mut cleaned = Vec::new();
    for s in steps {
        cleaned.push((clean_text(&s.text)?, clamp_minutes(s.minutes)));
    }
    if cleaned.is_empty() {
        return Err(invalid("No steps to save"));
    }
    cleaned.truncate(MAX_STEPS);
    let goal = goal.map(str::trim).filter(|g| !g.is_empty());
    let tx = c.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM micro_steps WHERE space_id IS ?1",
        params![space_id],
    )?;
    let now = now_ms();
    for (i, (text, minutes)) in cleaned.iter().enumerate() {
        tx.execute(
            "INSERT INTO micro_steps (id, space_id, session_id, goal, text, minutes, done, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
            params![new_id(), space_id, session_id, goal, text, minutes, i as i64, now],
        )?;
    }
    tx.commit()?;
    list_steps(c, space_id)
}

pub fn set_done(c: &Connection, id: &str, done: bool) -> AppResult<MicroStep> {
    let n = c.execute(
        "UPDATE micro_steps SET done = ?1 WHERE id = ?2",
        params![done as i64, id],
    )?;
    if n == 0 {
        return Err(not_found());
    }
    get_step(c, id)
}

pub fn update_step(
    c: &Connection,
    id: &str,
    text: Option<&str>,
    minutes: Option<i64>,
) -> AppResult<MicroStep> {
    get_step(c, id)?;
    if let Some(t) = text {
        c.execute(
            "UPDATE micro_steps SET text = ?1 WHERE id = ?2",
            params![clean_text(t)?, id],
        )?;
    }
    if let Some(m) = minutes {
        c.execute(
            "UPDATE micro_steps SET minutes = ?1 WHERE id = ?2",
            params![clamp_minutes(m), id],
        )?;
    }
    get_step(c, id)
}

pub fn delete_step(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM micro_steps WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_steps(c: &Connection, space_id: Option<&str>) -> AppResult<()> {
    c.execute(
        "DELETE FROM micro_steps WHERE space_id IS ?1",
        params![space_id],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn micro_steps_list(
    state: State<'_, AppState>,
    space_id: Option<String>,
) -> AppResult<Vec<MicroStep>> {
    list_steps(&state.db.conn()?, space_id.as_deref())
}

#[tauri::command]
pub async fn micro_steps_replace(
    state: State<'_, AppState>,
    space_id: Option<String>,
    session_id: Option<String>,
    goal: Option<String>,
    steps: Vec<NewMicroStep>,
) -> AppResult<Vec<MicroStep>> {
    replace_steps(
        &state.db.conn()?,
        space_id.as_deref(),
        session_id.as_deref(),
        goal.as_deref(),
        &steps,
    )
}

#[tauri::command]
pub async fn micro_step_set_done(
    state: State<'_, AppState>,
    id: String,
    done: bool,
) -> AppResult<MicroStep> {
    set_done(&state.db.conn()?, &id, done)
}

#[tauri::command]
pub async fn micro_step_update(
    state: State<'_, AppState>,
    id: String,
    text: Option<String>,
    minutes: Option<i64>,
) -> AppResult<MicroStep> {
    update_step(&state.db.conn()?, &id, text.as_deref(), minutes)
}

#[tauri::command]
pub async fn micro_step_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete_step(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn micro_steps_clear(
    state: State<'_, AppState>,
    space_id: Option<String>,
) -> AppResult<()> {
    clear_steps(&state.db.conn()?, space_id.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};

    fn ns(t: &str, m: i64) -> NewMicroStep {
        NewMicroStep {
            text: t.into(),
            minutes: m,
        }
    }

    #[test]
    fn replace_scopes_per_space_and_clamps() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let a = models::create_space(
            &c,
            models::SpacePatch {
                name: Some("A".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let first = replace_steps(
            &c,
            Some(&a.id),
            None,
            Some(" Ch 3 "),
            &[ns("Open the PDF", 1), ns("  Read page 1 ", 30)],
        )
        .unwrap();
        assert_eq!(
            first
                .iter()
                .map(|s| (s.text.as_str(), s.minutes, s.position))
                .collect::<Vec<_>>(),
            vec![("Open the PDF", 2, 0), ("Read page 1", 5, 1)]
        );
        assert_eq!(first[0].goal.as_deref(), Some("Ch 3"));
        replace_steps(&c, None, None, None, &[ns("General", 3)]).unwrap();
        assert_eq!(list_steps(&c, None).unwrap().len(), 1);
        assert_eq!(list_steps(&c, Some(&a.id)).unwrap().len(), 2);
        let second = replace_steps(&c, Some(&a.id), None, None, &[ns("New", 3)]).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(list_steps(&c, None).unwrap().len(), 1);
        assert!(replace_steps(&c, Some(&a.id), None, None, &[ns("  ", 3)]).is_err());
        assert!(replace_steps(&c, Some(&a.id), None, None, &[]).is_err());
        assert_eq!(list_steps(&c, Some(&a.id)).unwrap().len(), 1);
    }

    #[test]
    fn toggle_edit_delete_clear() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let steps = replace_steps(&c, None, None, None, &[ns("One", 2), ns("Two", 3)]).unwrap();
        assert!(set_done(&c, &steps[0].id, true).unwrap().done);
        assert!(!set_done(&c, &steps[0].id, false).unwrap().done);
        assert!(set_done(&c, "nope", true).is_err());
        let u = update_step(&c, &steps[1].id, Some(" Two b "), Some(9)).unwrap();
        assert_eq!((u.text.as_str(), u.minutes), ("Two b", 5));
        assert!(update_step(&c, &steps[1].id, Some(" "), None).is_err());
        delete_step(&c, &steps[0].id).unwrap();
        assert_eq!(list_steps(&c, None).unwrap().len(), 1);
        clear_steps(&c, None).unwrap();
        assert!(list_steps(&c, None).unwrap().is_empty());
    }

    #[test]
    fn steps_go_with_their_space() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let a = models::create_space(
            &c,
            models::SpacePatch {
                name: Some("A".into()),
                ..Default::default()
            },
        )
        .unwrap();
        replace_steps(&c, Some(&a.id), None, None, &[ns("One", 2)]).unwrap();
        models::delete_space(&c, &a.id).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM micro_steps", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}
