//! Goal skill graphs: one per space. The graph (topics, prerequisites, known flags, found
//! sources) is built and edited in the UI; this stores it as JSON.
use crate::db::now_ms;
use crate::error::{invalid, AppError, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub space_id: String,
    pub kind: String,
    pub title: String,
    pub graph: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn get_goal(c: &Connection, space_id: &str) -> AppResult<Option<Goal>> {
    let row = c
        .query_row(
            "SELECT space_id, kind, title, graph, created_at, updated_at FROM goal_graphs WHERE space_id=?1",
            [space_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()?;
    Ok(row.map(|(space_id, kind, title, graph, created_at, updated_at)| Goal {
        space_id,
        kind,
        title,
        graph: serde_json::from_str(&graph).unwrap_or(Value::Null),
        created_at,
        updated_at,
    }))
}

pub fn save_goal(c: &Connection, space_id: &str, kind: &str, title: &str, graph: &Value) -> AppResult<Goal> {
    if kind != "exam" && kind != "skill" {
        return Err(invalid("A goal is either an exam or a skill"));
    }
    if title.trim().is_empty() {
        return Err(invalid("A goal needs a title"));
    }
    if !graph.is_object() {
        return Err(invalid("The skill graph must be an object"));
    }
    let now = now_ms();
    c.execute(
        "INSERT INTO goal_graphs (space_id, kind, title, graph, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(space_id) DO UPDATE SET kind=?2, title=?3, graph=?4, updated_at=?5",
        params![space_id, kind, title.trim(), graph.to_string(), now],
    )?;
    get_goal(c, space_id)?.ok_or_else(|| AppError::NotFound("goal".into()))
}

pub fn delete_goal(c: &Connection, space_id: &str) -> AppResult<()> {
    c.execute("DELETE FROM goal_graphs WHERE space_id=?1", [space_id])?;
    Ok(())
}

#[tauri::command]
pub async fn goal_get(state: State<'_, AppState>, space_id: String) -> AppResult<Option<Goal>> {
    get_goal(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn goal_save(
    state: State<'_, AppState>,
    space_id: String,
    kind: String,
    title: String,
    graph: Value,
) -> AppResult<Goal> {
    save_goal(&state.db.conn()?, &space_id, &kind, &title, &graph)
}

#[tauri::command]
pub async fn goal_delete(state: State<'_, AppState>, space_id: String) -> AppResult<()> {
    delete_goal(&state.db.conn()?, &space_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};
    use serde_json::json;

    fn space(c: &Connection) -> String {
        models::create_space(
            c,
            models::SpacePatch {
                name: Some("A".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn save_upserts_and_round_trips_the_graph() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c);
        assert!(get_goal(&c, &sp).unwrap().is_none());
        let g = json!({"nodes": [{"id": "a", "title": "A"}]});
        save_goal(&c, &sp, "skill", "Build a robot arm", &g).unwrap();
        let again = save_goal(&c, &sp, "skill", "Robot arm", &json!({"nodes": []})).unwrap();
        assert_eq!(again.title, "Robot arm");
        assert_eq!(again.graph, json!({"nodes": []}));
        delete_goal(&c, &sp).unwrap();
        assert!(get_goal(&c, &sp).unwrap().is_none());
    }

    #[test]
    fn rejects_bad_kind_and_non_object_graph() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c);
        assert!(save_goal(&c, &sp, "hobby", "x", &json!({})).is_err());
        assert!(save_goal(&c, &sp, "skill", "x", &json!([])).is_err());
        assert!(save_goal(&c, &sp, "skill", " ", &json!({})).is_err());
    }
}
