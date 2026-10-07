//! Adaptive practice storage: per-topic ability estimates, generated items, attempts and error
//! types. The ability math (Rasch/Elo update) runs in the UI; this module stores the results.
use crate::db::{new_id, now_ms};
use crate::error::{invalid, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

const KINDS: &[&str] = &["mcq", "numeric", "short"];
pub const ERROR_TYPES: &[&str] = &["concept", "procedure", "arithmetic", "sign", "misread", "units", "careless", "vocabulary", "other"];

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ability {
    pub topic_key: String,
    pub topic_title: String,
    pub theta: f64,
    pub n: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PracticeItem {
    #[serde(default)]
    pub id: String,
    pub topic_key: String,
    pub kind: String,
    pub question: String,
    pub options: Option<Vec<String>>,
    pub answer: String,
    pub solution: String,
    pub difficulty: f64,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAttempt {
    pub item_id: String,
    pub topic_key: String,
    pub topic_title: String,
    pub response: String,
    pub correct: bool,
    pub theta_before: f64,
    pub theta_after: f64,
    pub error_type: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPattern {
    pub error_type: String,
    pub count: i64,
    pub last_at: i64,
    /// topics where this error happened most, up to 3
    pub topics: Vec<String>,
}

fn ability_from_row(r: &Row) -> rusqlite::Result<Ability> {
    Ok(Ability { topic_key: r.get(0)?, topic_title: r.get(1)?, theta: r.get(2)?, n: r.get(3)?, updated_at: r.get(4)? })
}

pub fn list_abilities(c: &Connection, space_id: &str) -> AppResult<Vec<Ability>> {
    let mut st = c.prepare("SELECT topic_key, topic_title, theta, n, updated_at FROM abilities WHERE space_id=?1 ORDER BY updated_at DESC")?;
    let rows = st.query_map([space_id], ability_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_ability(c: &Connection, space_id: &str, topic_key: &str) -> AppResult<Option<Ability>> {
    Ok(c.query_row(
        "SELECT topic_key, topic_title, theta, n, updated_at FROM abilities WHERE space_id=?1 AND topic_key=?2",
        params![space_id, topic_key],
        ability_from_row,
    )
    .optional()?)
}

pub fn add_item(c: &Connection, space_id: &str, item: &PracticeItem) -> AppResult<PracticeItem> {
    if !KINDS.contains(&item.kind.as_str()) {
        return Err(invalid(format!("Unknown item kind: {}", item.kind)));
    }
    if item.question.trim().is_empty() || item.answer.trim().is_empty() {
        return Err(invalid("A practice item needs a question and an answer"));
    }
    if item.kind == "mcq" && item.options.as_ref().map(|o| o.len() < 2).unwrap_or(true) {
        return Err(invalid("A multiple-choice item needs options"));
    }
    let hint = item.hint.as_ref().map(|h| h.trim().to_string()).filter(|h| !h.is_empty());
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO practice_items (id, space_id, topic_key, kind, question, options, answer, solution, difficulty, parent_id, hint, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            space_id,
            item.topic_key,
            item.kind,
            item.question.trim(),
            item.options.as_ref().map(|o| serde_json::to_string(o).unwrap_or_default()),
            item.answer.trim(),
            item.solution.trim(),
            item.difficulty.clamp(-4.0, 4.0),
            item.parent_id,
            hint,
            now
        ],
    )?;
    Ok(PracticeItem { id, hint, created_at: now, ..item.clone() })
}

/// Recent questions in a topic, newest first, so new items don't repeat them.
pub fn recent_questions(c: &Connection, space_id: &str, topic_key: &str, limit: i64) -> AppResult<Vec<String>> {
    let mut st = c.prepare("SELECT question FROM practice_items WHERE space_id=?1 AND topic_key=?2 ORDER BY created_at DESC LIMIT ?3")?;
    let rows = st.query_map(params![space_id, topic_key, limit], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Stores an attempt and the new ability estimate in one transaction.
pub fn record_attempt(c: &Connection, space_id: &str, a: &NewAttempt) -> AppResult<Ability> {
    if let Some(e) = &a.error_type {
        if !ERROR_TYPES.contains(&e.as_str()) {
            return Err(invalid(format!("Unknown error type: {e}")));
        }
    }
    if !a.theta_after.is_finite() {
        return Err(invalid("Ability must be a number"));
    }
    let tx = c.unchecked_transaction()?;
    let now = now_ms();
    tx.execute(
        "INSERT INTO practice_attempts (id, item_id, space_id, topic_key, response, correct, theta_before, theta_after, error_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![new_id(), a.item_id, space_id, a.topic_key, a.response, a.correct as i64, a.theta_before, a.theta_after, a.error_type, now],
    )?;
    tx.execute(
        "INSERT INTO abilities (space_id, topic_key, topic_title, theta, n, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)
         ON CONFLICT(space_id, topic_key) DO UPDATE SET theta=?4, n=n+1, topic_title=?3, updated_at=?5",
        params![space_id, a.topic_key, a.topic_title, a.theta_after.clamp(-4.0, 4.0), now],
    )?;
    tx.commit()?;
    Ok(get_ability(c, space_id, &a.topic_key)?.expect("just written"))
}

pub fn set_mistake_error_type(c: &Connection, id: &str, error_type: &str) -> AppResult<()> {
    if !ERROR_TYPES.contains(&error_type) {
        return Err(invalid(format!("Unknown error type: {error_type}")));
    }
    c.execute("UPDATE mistakes SET error_type=?2 WHERE id=?1", params![id, error_type])?;
    Ok(())
}

/// Error types across practice attempts and the mistake notebook, most frequent first.
pub fn error_patterns(c: &Connection, space_id: Option<&str>) -> AppResult<Vec<ErrorPattern>> {
    let mut st = c.prepare(
        "WITH e AS (
            SELECT a.error_type AS et, a.created_at AS at, coalesce(ab.topic_title, a.topic_key) AS topic
            FROM practice_attempts a LEFT JOIN abilities ab ON ab.space_id = a.space_id AND ab.topic_key = a.topic_key
            WHERE a.error_type IS NOT NULL AND (?1 IS NULL OR a.space_id = ?1)
            UNION ALL
            SELECT error_type, created_at, coalesce(topic, origin) FROM mistakes
            WHERE error_type IS NOT NULL AND origin <> 'practice' AND (?1 IS NULL OR space_id = ?1)
         )
         SELECT et, count(*), max(at), group_concat(topic, char(31)) FROM e GROUP BY et ORDER BY count(*) DESC, max(at) DESC",
    )?;
    let rows = st.query_map([space_id], |r| {
        let topics: Option<String> = r.get(3)?;
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, topics.unwrap_or_default()))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (error_type, count, last_at, topics) = row?;
        let mut tally: Vec<(String, usize)> = Vec::new();
        for t in topics.split('\u{1f}').filter(|t| !t.is_empty()) {
            match tally.iter_mut().find(|(k, _)| k == t) {
                Some(e) => e.1 += 1,
                None => tally.push((t.to_string(), 1)),
            }
        }
        tally.sort_by(|a, b| b.1.cmp(&a.1));
        out.push(ErrorPattern { error_type, count, last_at, topics: tally.into_iter().take(3).map(|(t, _)| t).collect() });
    }
    Ok(out)
}

// ---------- commands ----------

#[tauri::command]
pub async fn abilities_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Ability>> {
    list_abilities(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn ability_get(state: State<'_, AppState>, space_id: String, topic_key: String) -> AppResult<Option<Ability>> {
    get_ability(&state.db.conn()?, &space_id, &topic_key)
}

#[tauri::command]
pub async fn practice_item_add(state: State<'_, AppState>, space_id: String, item: PracticeItem) -> AppResult<PracticeItem> {
    add_item(&state.db.conn()?, &space_id, &item)
}

#[tauri::command]
pub async fn practice_recent(state: State<'_, AppState>, space_id: String, topic_key: String, limit: Option<i64>) -> AppResult<Vec<String>> {
    recent_questions(&state.db.conn()?, &space_id, &topic_key, limit.unwrap_or(15))
}

#[tauri::command]
pub async fn practice_attempt(state: State<'_, AppState>, space_id: String, attempt: NewAttempt) -> AppResult<Ability> {
    record_attempt(&state.db.conn()?, &space_id, &attempt)
}

#[tauri::command]
pub async fn mistake_set_error_type(state: State<'_, AppState>, id: String, error_type: String) -> AppResult<()> {
    set_mistake_error_type(&state.db.conn()?, &id, &error_type)
}

#[tauri::command]
pub async fn error_patterns_list(state: State<'_, AppState>, space_id: Option<String>) -> AppResult<Vec<ErrorPattern>> {
    error_patterns(&state.db.conn()?, space_id.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};

    fn item(kind: &str) -> PracticeItem {
        PracticeItem {
            id: String::new(),
            topic_key: "ged.math.percents".into(),
            kind: kind.into(),
            question: "15% of 80?".into(),
            options: if kind == "mcq" { Some(vec!["8".into(), "12".into()]) } else { None },
            answer: "12".into(),
            solution: "0.15 × 80 = 12".into(),
            difficulty: 9.0,
            parent_id: None,
            hint: None,
            created_at: 0,
        }
    }

    #[test]
    fn items_attempts_abilities_and_patterns() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = models::create_space(&c, models::SpacePatch { name: Some("GED".into()), ..Default::default() }).unwrap();
        assert!(add_item(&c, &sp.id, &PracticeItem { options: None, ..item("mcq") }).is_err());
        assert!(add_item(&c, &sp.id, &item("essay")).is_err());
        let it = add_item(&c, &sp.id, &item("numeric")).unwrap();
        assert!(it.hint.is_none());
        let hinted = add_item(&c, &sp.id, &PracticeItem { hint: Some("  Convert 15% to 0.15  ".into()), ..item("numeric") }).unwrap();
        assert_eq!(hinted.hint.as_deref(), Some("Convert 15% to 0.15"));
        let stored: Option<String> = c.query_row("SELECT hint FROM practice_items WHERE id=?1", [&hinted.id], |r| r.get(0)).unwrap();
        assert_eq!(stored.as_deref(), Some("Convert 15% to 0.15"));
        assert_eq!(recent_questions(&c, &sp.id, "ged.math.percents", 5).unwrap().len(), 2);

        let attempt = |correct: bool, before: f64, after: f64, et: Option<&str>| NewAttempt {
            item_id: it.id.clone(),
            topic_key: "ged.math.percents".into(),
            topic_title: "Percents".into(),
            response: "8".into(),
            correct,
            theta_before: before,
            theta_after: after,
            error_type: et.map(Into::into),
        };
        assert!(record_attempt(&c, &sp.id, &attempt(false, 0.0, -0.5, Some("rage"))).is_err());
        let a1 = record_attempt(&c, &sp.id, &attempt(false, 0.0, -0.5, Some("arithmetic"))).unwrap();
        assert_eq!((a1.n, a1.theta), (1, -0.5));
        let a2 = record_attempt(&c, &sp.id, &attempt(true, -0.5, -0.1, None)).unwrap();
        assert_eq!(a2.n, 2);
        record_attempt(&c, &sp.id, &attempt(false, -0.1, -0.4, Some("arithmetic"))).unwrap();

        let ms = crate::cards::add_mistakes(
            &c,
            &sp.id,
            &[crate::cards::NewMistake {
                origin: "quiz".into(),
                question: "q".into(),
                given: None,
                correct: "a".into(),
                explanation: None,
                topic: Some("Algebra".into()),
                options: None,
            }],
        )
        .unwrap();
        set_mistake_error_type(&c, &ms[0].id, "sign").unwrap();
        assert!(set_mistake_error_type(&c, &ms[0].id, "bad").is_err());

        let p = error_patterns(&c, Some(&sp.id)).unwrap();
        assert_eq!(p[0].error_type, "arithmetic");
        assert_eq!(p[0].count, 2);
        assert_eq!(p[0].topics, vec!["Percents"]);
        assert_eq!(p[1].error_type, "sign");
        assert_eq!(list_abilities(&c, &sp.id).unwrap().len(), 1);
    }
}
