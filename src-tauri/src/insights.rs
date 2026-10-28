//! Raw study activity for the Insights screen. The analytics (retention curves, best study time,
//! readiness) run in the UI on these rows, so this module only selects them.
use crate::error::AppResult;
use crate::AppState;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRow {
    pub card_id: String,
    pub space_id: String,
    pub source_id: Option<String>,
    pub rating: i64,
    pub reviewed_at: i64,
    pub confidence: Option<i64>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusRow {
    pub space_id: Option<String>,
    pub started_at: i64,
    pub focus_ms: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttemptRow {
    pub space_id: String,
    pub topic_key: String,
    pub correct: bool,
    pub created_at: i64,
    pub confidence: Option<i64>,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub reviews: Vec<ReviewRow>,
    pub focus: Vec<FocusRow>,
    pub attempts: Vec<AttemptRow>,
}

/// Everything since `since` (ms), oldest first, for one space or all of them.
pub fn activity(c: &Connection, space_id: Option<&str>, since: i64) -> AppResult<Activity> {
    let mut st = c.prepare(
        "SELECT r.card_id, c.space_id, c.source_id, r.rating, r.reviewed_at, r.confidence FROM review_logs r JOIN cards c ON c.id = r.card_id
         WHERE (?1 IS NULL OR c.space_id = ?1) AND r.reviewed_at >= ?2 ORDER BY r.reviewed_at, r.id",
    )?;
    let reviews = st
        .query_map(rusqlite::params![space_id, since], |r| {
            Ok(ReviewRow {
                card_id: r.get(0)?,
                space_id: r.get(1)?,
                source_id: r.get(2)?,
                rating: r.get(3)?,
                reviewed_at: r.get(4)?,
                confidence: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut st = c.prepare(
        "SELECT space_id, started_at, focus_ms FROM focus_sessions
         WHERE (?1 IS NULL OR space_id = ?1) AND started_at >= ?2 AND focus_ms > 0 ORDER BY started_at",
    )?;
    let focus = st
        .query_map(rusqlite::params![space_id, since], |r| {
            Ok(FocusRow {
                space_id: r.get(0)?,
                started_at: r.get(1)?,
                focus_ms: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut st = c.prepare(
        "SELECT space_id, topic_key, correct, created_at, confidence FROM practice_attempts
         WHERE (?1 IS NULL OR space_id = ?1) AND created_at >= ?2 ORDER BY created_at",
    )?;
    let attempts = st
        .query_map(rusqlite::params![space_id, since], |r| {
            Ok(AttemptRow {
                space_id: r.get(0)?,
                topic_key: r.get(1)?,
                correct: r.get::<_, i64>(2)? != 0,
                created_at: r.get(3)?,
                confidence: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut attempts: Vec<AttemptRow> = attempts;
    let mut st = c.prepare(
        "SELECT space_id, data, completed_at FROM exam_attempts
         WHERE (?1 IS NULL OR space_id = ?1) AND completed_at >= ?2",
    )?;
    let exams = st.query_map(rusqlite::params![space_id, since], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    })?;
    for e in exams {
        let (space, data, at) = e?;
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) else { continue };
        for row in v["calibration"].as_array().into_iter().flatten() {
            let (Some(topic), Some(correct), Some(conf)) = (row["topicKey"].as_str(), row["correct"].as_bool(), row["confidence"].as_i64()) else { continue };
            attempts.push(AttemptRow {
                space_id: space.clone(),
                topic_key: topic.to_string(),
                correct,
                created_at: at,
                confidence: Some(conf),
            });
        }
    }
    attempts.sort_by_key(|a| a.created_at);
    Ok(Activity {
        reviews,
        focus,
        attempts,
    })
}

#[tauri::command]
pub async fn insights_activity(
    state: State<'_, AppState>,
    space_id: Option<String>,
    since: i64,
) -> AppResult<Activity> {
    activity(&state.db.conn()?, space_id.as_deref(), since)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::{add_cards, NewCard};
    use crate::db::{models, test_db};

    #[test]
    fn activity_filters_by_space_and_time() {
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
        let b = models::create_space(
            &c,
            models::SpacePatch {
                name: Some("B".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let card = |f: &str| NewCard {
            kind: "basic".into(),
            front: f.into(),
            back: "x".into(),
            data: None,
            source_id: None,
            chunk_start: None,
            chunk_end: None,
            origin: None,
        };
        let ca = add_cards(&c, &a.id, &[card("Q1")]).unwrap();
        let cb = add_cards(&c, &b.id, &[card("Q2")]).unwrap();
        for (id, rating, at) in [
            (&ca[0].id, 3, 100),
            (&ca[0].id, 1, 300),
            (&cb[0].id, 4, 200),
            (&ca[0].id, 3, 10),
        ] {
            c.execute(
                "INSERT INTO review_logs (card_id, rating, reviewed_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![id, rating, at],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO focus_sessions (id, space_id, technique, config, state, started_at, focus_ms) VALUES ('f1', ?1, 'pomodoro', '{}', 'done', 150, 1500000), ('f2', ?1, 'pomodoro', '{}', 'done', 160, 0)",
            [&a.id],
        )
        .unwrap();
        c.execute("INSERT INTO practice_items (id, space_id, topic_key, kind, question, answer, solution, difficulty, created_at) VALUES ('i1', ?1, 't', 'numeric', 'q', '1', 's', 0, 0)", [&b.id]).unwrap();
        c.execute(
            "INSERT INTO practice_attempts (id, item_id, space_id, topic_key, response, correct, theta_before, theta_after, created_at) VALUES ('p1', 'i1', ?1, 't', '1', 1, 0, 0.2, 250)",
            [&b.id],
        )
        .unwrap();

        let all = activity(&c, None, 50).unwrap();
        assert_eq!(
            all.reviews
                .iter()
                .map(|r| r.reviewed_at)
                .collect::<Vec<_>>(),
            vec![100, 200, 300]
        );
        assert_eq!(
            all.focus.len(),
            1,
            "sessions without focus time are left out"
        );
        assert_eq!(
            all.attempts,
            vec![AttemptRow {
                space_id: b.id.clone(),
                topic_key: "t".into(),
                correct: true,
                created_at: 250,
                confidence: None
            }]
        );

        let only_a = activity(&c, Some(&a.id), 0).unwrap();
        assert_eq!(only_a.reviews.len(), 3);
        assert!(only_a.reviews.iter().all(|r| r.space_id == a.id));
        assert!(only_a.attempts.is_empty());
    }

    #[test]
    fn finished_exams_add_calibration_rows() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let a = models::create_space(&c, models::SpacePatch { name: Some("A".into()), ..Default::default() }).unwrap();
        let data = serde_json::json!({"calibration": [{"topicKey": "alg", "correct": false, "confidence": 2}]}).to_string();
        c.execute(
            "INSERT INTO exam_attempts (id, space_id, exam_id, section, length, data, started_at, completed_at, time_used_ms) VALUES ('e1', ?1, 'ged', 'math', 'short', ?2, 1, 500, 0)",
            rusqlite::params![a.id, data],
        )
        .unwrap();
        let act = activity(&c, Some(&a.id), 0).unwrap();
        assert_eq!(
            act.attempts,
            vec![AttemptRow { space_id: a.id.clone(), topic_key: "alg".into(), correct: false, created_at: 500, confidence: Some(2) }]
        );
        assert!(activity(&c, Some(&a.id), 501).unwrap().attempts.is_empty());
    }
}
