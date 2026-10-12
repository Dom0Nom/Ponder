//! Curriculum per space, topic levels, assessments (placement / prerequisite / lesson checks) and
//! textbook courses. Question generation and grading happen in the UI; this stores the results.
use crate::db::{new_id, now_ms};
use crate::error::{invalid, AppError, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

const LEVELS: &[&str] = &["unknown", "weak", "ok", "strong"];
const KINDS: &[&str] = &["placement", "prereq", "lesson"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpaceCurriculum {
    pub space_id: String,
    pub curriculum_id: String,
    pub title: String,
    pub topics: Value,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TopicLevel {
    pub topic_id: String,
    pub level: String,
    pub evidence: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Assessment {
    pub id: String,
    pub space_id: String,
    pub kind: String,
    pub topic_id: Option<String>,
    pub title: String,
    pub questions: Value,
    pub answers: Option<Value>,
    pub score: Option<f64>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: String,
    pub course_id: String,
    pub ord: i64,
    pub title: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub status: String,
    pub score: Option<f64>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub space_id: String,
    pub source_id: String,
    pub title: String,
    pub created_at: i64,
    pub lessons: Vec<Lesson>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLesson {
    pub title: String,
    pub start_offset: i64,
    pub end_offset: i64,
}

fn json(r: &Row, col: &str) -> rusqlite::Result<Option<Value>> {
    let s: Option<String> = r.get(col)?;
    Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn get_curriculum(c: &Connection, space_id: &str) -> AppResult<Option<SpaceCurriculum>> {
    Ok(c.query_row("SELECT * FROM space_curricula WHERE space_id=?1", [space_id], |r| {
        Ok(SpaceCurriculum {
            space_id: r.get("space_id")?,
            curriculum_id: r.get("curriculum_id")?,
            title: r.get("title")?,
            topics: json(r, "topics")?.unwrap_or(Value::Array(vec![])),
            updated_at: r.get("updated_at")?,
        })
    })
    .optional()?)
}

pub fn set_curriculum(c: &Connection, space_id: &str, curriculum_id: &str, title: &str, topics: &Value) -> AppResult<SpaceCurriculum> {
    if !topics.is_array() || topics.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        return Err(invalid("A curriculum needs at least one topic"));
    }
    let tx = c.unchecked_transaction()?;
    let c = &tx;
    let changed = match get_curriculum(c, space_id)? {
        Some(old) => old.curriculum_id != curriculum_id || &old.topics != topics,
        None => false,
    };
    if changed {
        c.execute("DELETE FROM topic_levels WHERE space_id=?1", [space_id])?;
        c.execute("DELETE FROM abilities WHERE space_id=?1 AND topic_key NOT LIKE 'free:%'", [space_id])?;
        c.execute("DELETE FROM plan_tasks WHERE space_id=?1 AND topic_id IS NOT NULL AND done_at IS NULL", [space_id])?;
    }
    c.execute(
        "INSERT INTO space_curricula (space_id, curriculum_id, title, topics, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(space_id) DO UPDATE SET curriculum_id=?2, title=?3, topics=?4, updated_at=?5",
        params![space_id, curriculum_id, title, topics.to_string(), now_ms()],
    )?;
    let out = get_curriculum(c, space_id)?.ok_or_else(|| AppError::NotFound("curriculum".into()));
    tx.commit()?;
    out
}

pub fn clear_curriculum(c: &Connection, space_id: &str) -> AppResult<()> {
    c.execute("DELETE FROM space_curricula WHERE space_id=?1", [space_id])?;
    Ok(())
}

pub fn list_levels(c: &Connection, space_id: &str) -> AppResult<Vec<TopicLevel>> {
    let mut st = c.prepare("SELECT topic_id, level, evidence, updated_at FROM topic_levels WHERE space_id=?1")?;
    let rows = st.query_map([space_id], |r| {
        Ok(TopicLevel { topic_id: r.get(0)?, level: r.get(1)?, evidence: r.get(2)?, updated_at: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn set_level(c: &Connection, space_id: &str, topic_id: &str, level: &str, evidence: Option<&str>) -> AppResult<()> {
    if !LEVELS.contains(&level) {
        return Err(invalid(format!("Unknown level: {level}")));
    }
    c.execute(
        "INSERT INTO topic_levels (space_id, topic_id, level, evidence, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(space_id, topic_id) DO UPDATE SET level=?3, evidence=?4, updated_at=?5",
        params![space_id, topic_id, level, evidence, now_ms()],
    )?;
    Ok(())
}

fn assessment_from_row(r: &Row) -> rusqlite::Result<Assessment> {
    Ok(Assessment {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        kind: r.get("kind")?,
        topic_id: r.get("topic_id")?,
        title: r.get("title")?,
        questions: json(r, "questions")?.unwrap_or(Value::Array(vec![])),
        answers: json(r, "answers")?,
        score: r.get("score")?,
        created_at: r.get("created_at")?,
        completed_at: r.get("completed_at")?,
    })
}

pub fn create_assessment(
    c: &Connection,
    space_id: &str,
    kind: &str,
    topic_id: Option<&str>,
    title: &str,
    questions: &Value,
) -> AppResult<Assessment> {
    if !KINDS.contains(&kind) {
        return Err(invalid(format!("Unknown assessment kind: {kind}")));
    }
    if questions.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        return Err(invalid("An assessment needs at least one question"));
    }
    let id = new_id();
    c.execute(
        "INSERT INTO assessments (id, space_id, kind, topic_id, title, questions, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, space_id, kind, topic_id, title, questions.to_string(), now_ms()],
    )?;
    Ok(c.query_row("SELECT * FROM assessments WHERE id=?1", [&id], assessment_from_row)?)
}

pub fn complete_assessment(c: &Connection, id: &str, answers: &Value, score: f64) -> AppResult<Assessment> {
    if !(0.0..=1.0).contains(&score) {
        return Err(invalid("Score must be between 0 and 1"));
    }
    let n = c.execute(
        "UPDATE assessments SET answers=?2, score=?3, completed_at=?4 WHERE id=?1",
        params![id, answers.to_string(), score, now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound("assessment".into()));
    }
    Ok(c.query_row("SELECT * FROM assessments WHERE id=?1", [id], assessment_from_row)?)
}

pub fn list_assessments(c: &Connection, space_id: &str) -> AppResult<Vec<Assessment>> {
    let mut st = c.prepare("SELECT * FROM assessments WHERE space_id=?1 ORDER BY created_at DESC")?;
    let rows = st.query_map([space_id], assessment_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn lessons(c: &Connection, course_id: &str) -> AppResult<Vec<Lesson>> {
    let mut st = c.prepare("SELECT * FROM lessons WHERE course_id=?1 ORDER BY ord")?;
    let rows = st.query_map([course_id], |r| {
        Ok(Lesson {
            id: r.get("id")?,
            course_id: r.get("course_id")?,
            ord: r.get("ord")?,
            title: r.get("title")?,
            start_offset: r.get("start_offset")?,
            end_offset: r.get("end_offset")?,
            status: r.get("status")?,
            score: r.get("score")?,
            completed_at: r.get("completed_at")?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn list_courses(c: &Connection, space_id: &str) -> AppResult<Vec<Course>> {
    let mut st = c.prepare("SELECT id, space_id, source_id, title, created_at FROM courses WHERE space_id=?1 ORDER BY created_at")?;
    let rows: Vec<(String, String, String, String, i64)> = st
        .query_map([space_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<Result<_, _>>()?;
    rows.into_iter()
        .map(|(id, space_id, source_id, title, created_at)| {
            let lessons = lessons(c, &id)?;
            Ok(Course { id, space_id, source_id, title, created_at, lessons })
        })
        .collect()
}

pub fn create_course(c: &Connection, space_id: &str, source_id: &str, title: &str, items: &[NewLesson]) -> AppResult<Course> {
    if items.is_empty() {
        return Err(invalid("No chapters found in this source"));
    }
    let tx = c.unchecked_transaction()?;
    let id = new_id();
    tx.execute(
        "INSERT INTO courses (id, space_id, source_id, title, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, space_id, source_id, title, now_ms()],
    )?;
    for (i, l) in items.iter().enumerate() {
        if l.end_offset <= l.start_offset {
            return Err(invalid(format!("Chapter “{}” is empty", l.title)));
        }
        tx.execute(
            "INSERT INTO lessons (id, course_id, ord, title, start_offset, end_offset) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id(), id, i as i64, l.title, l.start_offset, l.end_offset],
        )?;
    }
    tx.commit()?;
    list_courses(c, space_id)?.into_iter().find(|x| x.id == id).ok_or_else(|| AppError::NotFound("course".into()))
}

pub fn set_lesson_status(c: &Connection, id: &str, status: &str, score: Option<f64>) -> AppResult<()> {
    if !["todo", "doing", "done"].contains(&status) {
        return Err(invalid(format!("Unknown lesson status: {status}")));
    }
    let done_at = (status == "done").then(now_ms);
    let n = c.execute(
        "UPDATE lessons SET status=?2, score=coalesce(?3, score), completed_at=?4 WHERE id=?1",
        params![id, status, score, done_at],
    )?;
    if n == 0 {
        return Err(AppError::NotFound("lesson".into()));
    }
    Ok(())
}

pub fn delete_course(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM courses WHERE id=?1", [id])?;
    Ok(())
}

// ---------- commands ----------

#[tauri::command]
pub async fn curriculum_get(state: State<'_, AppState>, space_id: String) -> AppResult<Option<SpaceCurriculum>> {
    get_curriculum(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn curriculum_set(
    state: State<'_, AppState>,
    space_id: String,
    curriculum_id: String,
    title: String,
    topics: Value,
) -> AppResult<SpaceCurriculum> {
    set_curriculum(&state.db.conn()?, &space_id, &curriculum_id, &title, &topics)
}

#[tauri::command]
pub async fn curriculum_clear(state: State<'_, AppState>, space_id: String) -> AppResult<()> {
    clear_curriculum(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn topic_levels(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<TopicLevel>> {
    list_levels(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn topic_level_set(
    state: State<'_, AppState>,
    space_id: String,
    topic_id: String,
    level: String,
    evidence: Option<String>,
) -> AppResult<()> {
    set_level(&state.db.conn()?, &space_id, &topic_id, &level, evidence.as_deref())
}

#[tauri::command]
pub async fn assessment_create(
    state: State<'_, AppState>,
    space_id: String,
    kind: String,
    topic_id: Option<String>,
    title: String,
    questions: Value,
) -> AppResult<Assessment> {
    create_assessment(&state.db.conn()?, &space_id, &kind, topic_id.as_deref(), &title, &questions)
}

#[tauri::command]
pub async fn assessment_complete(state: State<'_, AppState>, id: String, answers: Value, score: f64) -> AppResult<Assessment> {
    complete_assessment(&state.db.conn()?, &id, &answers, score)
}

#[tauri::command]
pub async fn assessments_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Assessment>> {
    list_assessments(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn courses_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Course>> {
    list_courses(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn course_create(
    state: State<'_, AppState>,
    space_id: String,
    source_id: String,
    title: String,
    lessons: Vec<NewLesson>,
) -> AppResult<Course> {
    create_course(&state.db.conn()?, &space_id, &source_id, &title, &lessons)
}

#[tauri::command]
pub async fn course_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete_course(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn lesson_set_status(state: State<'_, AppState>, id: String, status: String, score: Option<f64>) -> AppResult<()> {
    set_lesson_status(&state.db.conn()?, &id, &status, score)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};
    use serde_json::json;

    #[test]
    fn placement_data_roundtrip() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = models::create_space(&c, models::SpacePatch { name: Some("GED".into()), ..Default::default() }).unwrap();
        assert!(get_curriculum(&c, &sp.id).unwrap().is_none());
        assert!(set_curriculum(&c, &sp.id, "ged", "GED", &json!([])).is_err());
        let cur = set_curriculum(&c, &sp.id, "ged", "GED", &json!([{"id": "math.algebra", "title": "Algebra"}])).unwrap();
        assert_eq!(cur.curriculum_id, "ged");

        set_level(&c, &sp.id, "math.algebra", "weak", Some("1/3 correct")).unwrap();
        set_level(&c, &sp.id, "math.algebra", "ok", None).unwrap();
        assert!(set_level(&c, &sp.id, "x", "genius", None).is_err());
        assert_eq!(list_levels(&c, &sp.id).unwrap()[0].level, "ok");

        let a = create_assessment(&c, &sp.id, "placement", None, "Placement", &json!([{"q": "2+2?"}])).unwrap();
        assert!(complete_assessment(&c, &a.id, &json!([1]), 1.5).is_err());
        let done = complete_assessment(&c, &a.id, &json!([1]), 0.5).unwrap();
        assert_eq!(done.score, Some(0.5));
        assert!(create_assessment(&c, &sp.id, "exam", None, "x", &json!([1])).is_err());

        let src = models::insert_source(&c, &sp.id, "Book", "epub", None).unwrap();
        assert!(create_course(&c, &sp.id, &src.id, "Book", &[]).is_err());
        let course = create_course(
            &c,
            &sp.id,
            &src.id,
            "Book",
            &[
                NewLesson { title: "Ch 1".into(), start_offset: 0, end_offset: 100 },
                NewLesson { title: "Ch 2".into(), start_offset: 100, end_offset: 250 },
            ],
        )
        .unwrap();
        assert_eq!(course.lessons.len(), 2);
        set_lesson_status(&c, &course.lessons[0].id, "done", Some(0.66)).unwrap();
        let again = &list_courses(&c, &sp.id).unwrap()[0];
        assert_eq!(again.lessons[0].status, "done");
        assert!(again.lessons[0].completed_at.is_some());

        models::delete_source(&c, &src.id).unwrap();
        assert!(list_courses(&c, &sp.id).unwrap().is_empty());
    }

    #[test]
    fn replacing_curriculum_clears_topic_state() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = models::create_space(&c, models::SpacePatch { name: Some("X".into()), ..Default::default() }).unwrap();
        let first = json!([{"id": "custom.1", "title": "Old"}, {"id": "custom.2", "title": "Old 2"}]);
        set_curriculum(&c, &sp.id, "custom", "A", &first).unwrap();
        set_level(&c, &sp.id, "custom.1", "strong", None).unwrap();
        c.execute(
            "INSERT INTO abilities (space_id, topic_key, topic_title, theta, n, updated_at) VALUES (?1, 'custom.1', 'Old', 1.0, 3, 0), (?1, 'free:x', 'x', 0.5, 1, 0)",
            [&sp.id],
        )
        .unwrap();
        c.execute(
            "INSERT INTO plan_tasks (id, space_id, date, ord, kind, topic_id, title, minutes, done_at) VALUES ('t1', ?1, '2030-01-01', 0, 'study', 'custom.1', 'Old', 30, NULL)",
            [&sp.id],
        )
        .unwrap();

        set_curriculum(&c, &sp.id, "custom", "A", &first).unwrap();
        assert_eq!(list_levels(&c, &sp.id).unwrap().len(), 1);

        set_curriculum(&c, &sp.id, "custom", "B", &json!([{"id": "custom.1", "title": "New"}, {"id": "custom.2", "title": "New 2"}])).unwrap();
        assert!(list_levels(&c, &sp.id).unwrap().is_empty());
        let keys: Vec<String> = c.prepare("SELECT topic_key FROM abilities WHERE space_id=?1").unwrap().query_map([&sp.id], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(keys, vec!["free:x".to_string()]);
        let n: i64 = c.query_row("SELECT count(*) FROM plan_tasks WHERE space_id=?1", [&sp.id], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
