//! Projects: milestones linked to skill-graph topics, plus a dated build log.
use crate::db::{new_id, now_ms};
use crate::error::{AppError, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub topic_ids: Vec<String>,
    #[serde(default)]
    pub position: i64,
    #[serde(default)]
    pub done_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub photo: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub code_result: Option<String>,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    #[serde(default)]
    pub id: String,
    pub space_id: String,
    pub title: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub milestones: Vec<Milestone>,
    #[serde(default)]
    pub log: Vec<LogEntry>,
}

fn milestones(c: &Connection, project_id: &str) -> AppResult<Vec<Milestone>> {
    let mut st = c.prepare(
        "SELECT id, project_id, title, topic_ids, position, done_at FROM project_milestones WHERE project_id=?1 ORDER BY position, rowid",
    )?;
    let rows = st
        .query_map([project_id], |r| {
            let t: String = r.get(3)?;
            Ok(Milestone {
                id: r.get(0)?,
                project_id: r.get(1)?,
                title: r.get(2)?,
                topic_ids: serde_json::from_str(&t).unwrap_or_default(),
                position: r.get(4)?,
                done_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn log(c: &Connection, project_id: &str) -> AppResult<Vec<LogEntry>> {
    let mut st = c.prepare(
        "SELECT id, project_id, body, photo, code, code_result, created_at FROM project_log WHERE project_id=?1 ORDER BY created_at DESC, rowid DESC",
    )?;
    let rows = st
        .query_map([project_id], |r| {
            Ok(LogEntry {
                id: r.get(0)?,
                project_id: r.get(1)?,
                body: r.get(2)?,
                photo: r.get(3)?,
                code: r.get(4)?,
                code_result: r.get(5)?,
                created_at: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list(c: &Connection, space_id: &str) -> AppResult<Vec<Project>> {
    let mut st = c.prepare(
        "SELECT id, space_id, title, goal, created_at, updated_at FROM projects WHERE space_id=?1 ORDER BY updated_at DESC, rowid DESC",
    )?;
    let base = st
        .query_map([space_id], |r| {
            Ok(Project {
                id: r.get(0)?,
                space_id: r.get(1)?,
                title: r.get(2)?,
                goal: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
                milestones: vec![],
                log: vec![],
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    base.into_iter()
        .map(|mut p| {
            p.milestones = milestones(c, &p.id)?;
            p.log = log(c, &p.id)?;
            Ok(p)
        })
        .collect()
}

fn touch(c: &Connection, project_id: &str) -> AppResult<()> {
    c.execute("UPDATE projects SET updated_at=?2 WHERE id=?1", params![project_id, now_ms()])?;
    Ok(())
}

pub fn save(c: &Connection, p: &Project) -> AppResult<Project> {
    let title = p.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("A project needs a title".into()));
    }
    let id = if p.id.is_empty() { new_id() } else { p.id.clone() };
    let now = now_ms();
    let created = c
        .query_row("SELECT created_at FROM projects WHERE id=?1", [&id], |r| r.get::<_, i64>(0))
        .optional()?
        .unwrap_or(now);
    c.execute(
        "INSERT INTO projects (id, space_id, title, goal, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET title=?3, goal=?4, updated_at=?5",
        params![id, p.space_id, title, p.goal.trim(), now],
    )?;
    let _ = created;
    get(c, &id)
}

pub fn get(c: &Connection, id: &str) -> AppResult<Project> {
    let space: String = c
        .query_row("SELECT space_id FROM projects WHERE id=?1", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::NotFound("Project".into()))?;
    list(c, &space)?.into_iter().find(|p| p.id == id).ok_or_else(|| AppError::NotFound("Project".into()))
}

pub fn delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM projects WHERE id=?1", [id])?;
    Ok(())
}

pub fn milestone_upsert(c: &Connection, m: &Milestone) -> AppResult<Milestone> {
    let title = m.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("A milestone needs a title".into()));
    }
    let id = if m.id.is_empty() { new_id() } else { m.id.clone() };
    let position = if m.position > 0 || !m.id.is_empty() {
        m.position
    } else {
        c.query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM project_milestones WHERE project_id=?1", [&m.project_id], |r| r.get(0))?
    };
    let topics = serde_json::to_string(&m.topic_ids)?;
    c.execute(
        "INSERT INTO project_milestones (id, project_id, title, topic_ids, position, done_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET title=?3, topic_ids=?4, position=?5",
        params![id, m.project_id, title, topics, position, m.done_at],
    )?;
    touch(c, &m.project_id)?;
    milestones(c, &m.project_id)?.into_iter().find(|x| x.id == id).ok_or_else(|| AppError::NotFound("Milestone".into()))
}

pub fn milestone_remove(c: &Connection, id: &str) -> AppResult<()> {
    let pid: Option<String> = c.query_row("SELECT project_id FROM project_milestones WHERE id=?1", [id], |r| r.get(0)).optional()?;
    c.execute("DELETE FROM project_milestones WHERE id=?1", [id])?;
    if let Some(p) = pid {
        touch(c, &p)?;
    }
    Ok(())
}

pub fn set_done(c: &Connection, id: &str, done: bool) -> AppResult<()> {
    let at = if done { Some(now_ms()) } else { None };
    c.execute("UPDATE project_milestones SET done_at=?2 WHERE id=?1", params![id, at])?;
    if let Some(p) = c.query_row("SELECT project_id FROM project_milestones WHERE id=?1", [id], |r| r.get::<_, String>(0)).optional()? {
        touch(c, &p)?;
    }
    Ok(())
}

pub fn log_insert(c: &Connection, e: &LogEntry) -> AppResult<LogEntry> {
    if e.body.trim().is_empty() && e.photo.is_none() && e.code.is_none() {
        return Err(AppError::Invalid("A log entry needs text, a photo or code".into()));
    }
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO project_log (id, project_id, body, photo, code, code_result, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, e.project_id, e.body.trim(), e.photo, e.code, e.code_result, now],
    )?;
    touch(c, &e.project_id)?;
    Ok(LogEntry { id, created_at: now, body: e.body.trim().into(), ..e.clone() })
}

#[tauri::command]
pub async fn projects_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Project>> {
    list(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn project_save(state: State<'_, AppState>, project: Project) -> AppResult<Project> {
    save(&state.db.conn()?, &project)
}

#[tauri::command]
pub async fn project_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn milestone_save(state: State<'_, AppState>, milestone: Milestone) -> AppResult<Milestone> {
    milestone_upsert(&state.db.conn()?, &milestone)
}

#[tauri::command]
pub async fn milestone_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    milestone_remove(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn milestone_done(state: State<'_, AppState>, id: String, done: bool) -> AppResult<()> {
    set_done(&state.db.conn()?, &id, done)
}

#[tauri::command]
pub async fn log_add(state: State<'_, AppState>, entry: LogEntry) -> AppResult<LogEntry> {
    log_insert(&state.db.conn()?, &entry)
}

#[tauri::command]
pub async fn log_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.conn()?.execute("DELETE FROM project_log WHERE id=?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models;

    fn setup() -> (Connection, String, tempfile::TempDir) {
        let (db, dir) = crate::db::test_db();
        let c = db.conn().unwrap();
        let space = models::create_space(&c, models::SpacePatch { name: Some("S".into()), ..Default::default() }).unwrap().id;
        (c, space, dir)
    }

    fn project(space: &str, title: &str) -> Project {
        Project { id: String::new(), space_id: space.into(), title: title.into(), goal: String::new(), created_at: 0, updated_at: 0, milestones: vec![], log: vec![] }
    }

    #[test]
    fn project_milestones_and_log() {
        let (c, space, _d) = setup();
        let p = save(&c, &project(&space, " Robot arm ")).unwrap();
        assert_eq!(p.title, "Robot arm");
        let m1 = milestone_upsert(&c, &Milestone { id: String::new(), project_id: p.id.clone(), title: "Wire motors".into(), topic_ids: vec!["t1".into(), "t2".into()], position: 0, done_at: None }).unwrap();
        let m2 = milestone_upsert(&c, &Milestone { id: String::new(), project_id: p.id.clone(), title: "Write controller".into(), topic_ids: vec![], position: 0, done_at: None }).unwrap();
        assert!(m2.position > m1.position);
        assert_eq!(m1.topic_ids, vec!["t1", "t2"]);
        set_done(&c, &m1.id, true).unwrap();
        log_insert(&c, &LogEntry { id: String::new(), project_id: p.id.clone(), body: "First spin".into(), photo: None, code: Some("x".into()), code_result: Some("ok".into()), created_at: 0 }).unwrap();
        let got = list(&c, &space).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].milestones.len(), 2);
        assert!(got[0].milestones[0].done_at.is_some());
        assert_eq!(got[0].log[0].code_result.as_deref(), Some("ok"));
        assert!(log_insert(&c, &LogEntry { id: String::new(), project_id: p.id.clone(), body: " ".into(), photo: None, code: None, code_result: None, created_at: 0 }).is_err());
    }

    #[test]
    fn delete_cascades_and_empty_title_rejected() {
        let (c, space, _d) = setup();
        assert!(save(&c, &project(&space, "  ")).is_err());
        let p = save(&c, &project(&space, "A")).unwrap();
        milestone_upsert(&c, &Milestone { id: String::new(), project_id: p.id.clone(), title: "m".into(), topic_ids: vec![], position: 0, done_at: None }).unwrap();
        delete(&c, &p.id).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM project_milestones", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
