//! Per-topic mastery evidence. The state machine runs in the UI (`src/lib/insights/mastery.ts`);
//! this module stores its rows.
use crate::db::now_ms;
use crate::error::{invalid, AppResult};
use crate::AppState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

const STATES: [&str; 3] = ["learning", "retest", "mastered"];

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MasteryRow {
    pub topic_key: String,
    pub state: String,
    pub learned_at: i64,
    pub retest_due_at: Option<i64>,
    pub passed_at: Option<i64>,
}

pub fn list(c: &Connection, space_id: &str) -> AppResult<Vec<MasteryRow>> {
    let mut st = c.prepare(
        "SELECT topic_key, state, learned_at, retest_due_at, passed_at FROM mastery_evidence WHERE space_id=?1 ORDER BY topic_key",
    )?;
    let rows = st.query_map([space_id], |r| {
        Ok(MasteryRow {
            topic_key: r.get(0)?,
            state: r.get(1)?,
            learned_at: r.get(2)?,
            retest_due_at: r.get(3)?,
            passed_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn upsert(c: &Connection, space_id: &str, row: &MasteryRow) -> AppResult<()> {
    if !STATES.contains(&row.state.as_str()) {
        return Err(invalid(format!("Unknown mastery state: {}", row.state)));
    }
    c.execute(
        "INSERT INTO mastery_evidence (space_id, topic_key, state, learned_at, retest_due_at, passed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(space_id, topic_key) DO UPDATE SET state=?3, learned_at=?4, retest_due_at=?5, passed_at=?6, updated_at=?7",
        params![space_id, row.topic_key, row.state, row.learned_at, row.retest_due_at, row.passed_at, now_ms()],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn mastery_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<MasteryRow>> {
    list(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn mastery_upsert(state: State<'_, AppState>, space_id: String, row: MasteryRow) -> AppResult<()> {
    upsert(&state.db.conn()?, &space_id, &row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};

    fn space(c: &Connection) -> String {
        models::create_space(c, models::SpacePatch { name: Some("A".into()), ..Default::default() }).unwrap().id
    }

    #[test]
    fn upsert_replaces_row() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c);
        let mut row = MasteryRow { topic_key: "t".into(), state: "retest".into(), learned_at: 1, retest_due_at: Some(5), passed_at: None };
        upsert(&c, &sp, &row).unwrap();
        row.state = "mastered".into();
        row.passed_at = Some(9);
        upsert(&c, &sp, &row).unwrap();
        assert_eq!(list(&c, &sp).unwrap(), vec![row.clone()]);
        row.state = "bogus".into();
        assert!(upsert(&c, &sp, &row).is_err());
    }

    #[test]
    fn confidence_round_trips() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c);
        c.execute(
            "INSERT INTO practice_items (id, space_id, topic_key, kind, question, answer, solution, difficulty, created_at) VALUES ('i1', ?1, 't', 'short', 'q', 'a', 's', 0, 1)",
            [&sp],
        )
        .unwrap();
        let a = crate::practice::NewAttempt {
            item_id: "i1".into(),
            topic_key: "t".into(),
            topic_title: "T".into(),
            response: "a".into(),
            correct: true,
            theta_before: 0.0,
            theta_after: 0.1,
            error_type: None,
            confidence: Some(2),
        };
        crate::practice::record_attempt(&c, &sp, &a).unwrap();
        let act = crate::insights::activity(&c, Some(&sp), 0).unwrap();
        assert_eq!(act.attempts[0].confidence, Some(2));
        let bad = crate::practice::NewAttempt { confidence: Some(5), ..a };
        assert!(crate::practice::record_attempt(&c, &sp, &bad).is_err());
    }
}
