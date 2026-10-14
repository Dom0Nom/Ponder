//! Study plans: one per space (goal, exam date, weekly time, study days) plus the scheduled
//! tasks. The schedule is computed in the UI; this stores it and its progress.
use crate::db::{new_id, now_ms};
use crate::error::{invalid, AppError, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

const KINDS: &[&str] = &["learn", "practice", "review", "mock"];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlan {
    pub space_id: String,
    pub goal: String,
    pub exam_date: String,
    pub weekly_minutes: i64,
    pub study_days: Vec<i64>,
    pub replanned_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanTask {
    pub id: String,
    pub space_id: String,
    pub date: String,
    pub ord: i64,
    pub kind: String,
    pub topic_id: Option<String>,
    pub title: String,
    pub minutes: i64,
    pub done_at: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanBundle {
    pub plan: StudyPlan,
    pub tasks: Vec<PlanTask>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatedPlanTask {
    #[serde(flatten)]
    pub task: PlanTask,
    pub space_name: String,
    pub space_icon: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewPlanTask {
    pub date: String,
    pub ord: i64,
    pub kind: String,
    pub topic_id: Option<String>,
    pub title: String,
    pub minutes: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanFields {
    pub goal: String,
    pub exam_date: String,
    pub weekly_minutes: i64,
    pub study_days: Vec<i64>,
}

const TASK_COLS: &str = "id, space_id, date, ord, kind, topic_id, title, minutes, done_at";

fn task_row(r: &Row) -> rusqlite::Result<PlanTask> {
    Ok(PlanTask {
        id: r.get(0)?,
        space_id: r.get(1)?,
        date: r.get(2)?,
        ord: r.get(3)?,
        kind: r.get(4)?,
        topic_id: r.get(5)?,
        title: r.get(6)?,
        minutes: r.get(7)?,
        done_at: r.get(8)?,
    })
}

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let (Ok(y), Ok(m), Ok(day)) = (
        d[0..4].parse::<u32>(),
        d[5..7].parse::<u32>(),
        d[8..10].parse::<u32>(),
    ) else {
        return false;
    };
    y >= 1970 && (1..=12).contains(&m) && (1..=31).contains(&day)
}

fn list_tasks(c: &Connection, space_id: &str) -> AppResult<Vec<PlanTask>> {
    let mut st = c.prepare(&format!(
        "SELECT {TASK_COLS} FROM plan_tasks WHERE space_id=?1 ORDER BY date, ord"
    ))?;
    let rows = st.query_map([space_id], task_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_plan(c: &Connection, space_id: &str) -> AppResult<Option<StudyPlanBundle>> {
    let plan = c
        .query_row(
            "SELECT space_id, goal, exam_date, weekly_minutes, study_days, replanned_at, created_at, updated_at
             FROM study_plans WHERE space_id=?1",
            [space_id],
            |r| {
                let days: String = r.get(4)?;
                Ok(StudyPlan {
                    space_id: r.get(0)?,
                    goal: r.get(1)?,
                    exam_date: r.get(2)?,
                    weekly_minutes: r.get(3)?,
                    study_days: serde_json::from_str(&days).unwrap_or_default(),
                    replanned_at: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            },
        )
        .optional()?;
    match plan {
        Some(plan) => Ok(Some(StudyPlanBundle {
            plan,
            tasks: list_tasks(c, space_id)?,
        })),
        None => Ok(None),
    }
}

pub fn save_plan(
    c: &Connection,
    space_id: &str,
    f: &PlanFields,
    replanned: bool,
    tasks: &[NewPlanTask],
) -> AppResult<StudyPlanBundle> {
    let goal = f.goal.trim();
    if goal.is_empty() {
        return Err(invalid("A plan needs a goal"));
    }
    if !valid_date(&f.exam_date) {
        return Err(invalid("The exam date must look like 2026-12-31"));
    }
    if f.weekly_minutes <= 0 {
        return Err(invalid("Weekly study time must be more than zero"));
    }
    if f.study_days.is_empty() || f.study_days.iter().any(|d| !(0..=6).contains(d)) {
        return Err(invalid("Pick at least one study day"));
    }
    for t in tasks {
        if !KINDS.contains(&t.kind.as_str()) {
            return Err(invalid(format!("Unknown task kind: {}", t.kind)));
        }
        if !valid_date(&t.date) || t.minutes <= 0 || t.title.trim().is_empty() {
            return Err(invalid("Invalid plan task"));
        }
    }
    let now = now_ms();
    let days = serde_json::to_string(&f.study_days).unwrap_or_else(|_| "[]".into());
    let tx = c.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO study_plans (space_id, goal, exam_date, weekly_minutes, study_days, replanned_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(space_id) DO UPDATE SET goal=?2, exam_date=?3, weekly_minutes=?4, study_days=?5,
           replanned_at=CASE WHEN ?8 THEN ?7 ELSE replanned_at END, updated_at=?7",
        params![space_id, goal, f.exam_date, f.weekly_minutes, days, if replanned { Some(now) } else { None }, now, replanned],
    )?;
    tx.execute(
        "DELETE FROM plan_tasks WHERE space_id=?1 AND done_at IS NULL",
        [space_id],
    )?;
    for t in tasks {
        tx.execute(
            "INSERT INTO plan_tasks (id, space_id, date, ord, kind, topic_id, title, minutes, done_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            params![new_id(), space_id, t.date, t.ord, t.kind, t.topic_id, t.title.trim(), t.minutes],
        )?;
    }
    tx.commit()?;
    get_plan(c, space_id)?.ok_or_else(|| AppError::NotFound("study plan".into()))
}

pub fn set_task_done(c: &Connection, id: &str, done: bool) -> AppResult<PlanTask> {
    let n = c.execute(
        "UPDATE plan_tasks SET done_at=?2 WHERE id=?1",
        params![id, if done { Some(now_ms()) } else { None }],
    )?;
    if n == 0 {
        return Err(AppError::NotFound("plan task".into()));
    }
    Ok(c.query_row(
        &format!("SELECT {TASK_COLS} FROM plan_tasks WHERE id=?1"),
        [id],
        task_row,
    )?)
}

pub fn delete_plan(c: &Connection, space_id: &str) -> AppResult<()> {
    let tx = c.unchecked_transaction()?;
    tx.execute("DELETE FROM plan_tasks WHERE space_id=?1", [space_id])?;
    tx.execute("DELETE FROM study_plans WHERE space_id=?1", [space_id])?;
    tx.commit()?;
    Ok(())
}

pub fn tasks_between(c: &Connection, from: &str, to: &str) -> AppResult<Vec<DatedPlanTask>> {
    let mut st = c.prepare(
        "SELECT t.id, t.space_id, t.date, t.ord, t.kind, t.topic_id, t.title, t.minutes, t.done_at, s.name, s.icon
         FROM plan_tasks t JOIN spaces s ON s.id = t.space_id
         WHERE t.date >= ?1 AND t.date <= ?2
         ORDER BY t.date, s.name, t.ord",
    )?;
    let rows = st.query_map([from, to], |r| {
        Ok(DatedPlanTask {
            task: task_row(r)?,
            space_name: r.get(9)?,
            space_icon: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub async fn get_study_plan(
    state: State<'_, AppState>,
    space_id: String,
) -> AppResult<Option<StudyPlanBundle>> {
    get_plan(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn save_study_plan(
    state: State<'_, AppState>,
    space_id: String,
    plan: PlanFields,
    replanned: bool,
    tasks: Vec<NewPlanTask>,
) -> AppResult<StudyPlanBundle> {
    save_plan(&state.db.conn()?, &space_id, &plan, replanned, &tasks)
}

#[tauri::command]
pub async fn set_plan_task_done(
    state: State<'_, AppState>,
    id: String,
    done: bool,
) -> AppResult<PlanTask> {
    set_task_done(&state.db.conn()?, &id, done)
}

#[tauri::command]
pub async fn delete_study_plan(state: State<'_, AppState>, space_id: String) -> AppResult<()> {
    delete_plan(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn list_plan_tasks(
    state: State<'_, AppState>,
    from_date: String,
    to_date: String,
) -> AppResult<Vec<DatedPlanTask>> {
    tasks_between(&state.db.conn()?, &from_date, &to_date)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};

    fn fields() -> PlanFields {
        PlanFields {
            goal: "Pass the GED".into(),
            exam_date: "2026-12-01".into(),
            weekly_minutes: 300,
            study_days: vec![1, 3, 5],
        }
    }

    fn nt(date: &str, ord: i64, title: &str) -> NewPlanTask {
        NewPlanTask {
            date: date.into(),
            ord,
            kind: "learn".into(),
            topic_id: Some("t1".into()),
            title: title.into(),
            minutes: 30,
        }
    }

    fn space(c: &Connection, name: &str) -> String {
        models::create_space(
            c,
            models::SpacePatch {
                name: Some(name.into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn save_upserts_and_get_returns_ordered_tasks() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c, "A");
        assert!(get_plan(&c, &sp).unwrap().is_none());
        let b = save_plan(
            &c,
            &sp,
            &fields(),
            false,
            &[nt("2026-10-14", 1, "B"), nt("2026-10-13", 0, "A")],
        )
        .unwrap();
        assert_eq!(b.plan.study_days, vec![1, 3, 5]);
        assert_eq!(
            b.tasks.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
            vec!["A", "B"]
        );
        assert!(b.plan.replanned_at.is_none());
        let mut f = fields();
        f.goal = "New goal".into();
        let b = save_plan(&c, &sp, &f, true, &[nt("2026-10-15", 0, "C")]).unwrap();
        assert_eq!(b.plan.goal, "New goal");
        assert!(b.plan.replanned_at.is_some());
        assert_eq!(b.tasks.len(), 1);
    }

    #[test]
    fn save_validates() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c, "A");
        let mut f = fields();
        f.exam_date = "tomorrow".into();
        assert!(save_plan(&c, &sp, &f, false, &[]).is_err());
        let mut f = fields();
        f.study_days = vec![];
        assert!(save_plan(&c, &sp, &f, false, &[]).is_err());
        let mut f = fields();
        f.study_days = vec![7];
        assert!(save_plan(&c, &sp, &f, false, &[]).is_err());
        let mut f = fields();
        f.weekly_minutes = 0;
        assert!(save_plan(&c, &sp, &f, false, &[]).is_err());
        let mut bad = nt("2026-10-14", 0, "x");
        bad.kind = "nap".into();
        assert!(save_plan(&c, &sp, &fields(), false, &[bad]).is_err());
        assert!(get_plan(&c, &sp).unwrap().is_none());
    }

    #[test]
    fn save_keeps_done_tasks_and_replaces_the_rest() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c, "A");
        let b = save_plan(
            &c,
            &sp,
            &fields(),
            false,
            &[
                nt("2026-10-13", 0, "done one"),
                nt("2026-10-14", 0, "open one"),
            ],
        )
        .unwrap();
        set_task_done(&c, &b.tasks[0].id, true).unwrap();
        let b = save_plan(&c, &sp, &fields(), true, &[nt("2026-10-16", 0, "fresh")]).unwrap();
        let titles: Vec<_> = b.tasks.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["done one", "fresh"]);
        assert!(b.tasks[0].done_at.is_some());
    }

    #[test]
    fn toggle_done() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = space(&c, "A");
        let b = save_plan(&c, &sp, &fields(), false, &[nt("2026-10-13", 0, "A")]).unwrap();
        assert!(set_task_done(&c, &b.tasks[0].id, true)
            .unwrap()
            .done_at
            .is_some());
        assert!(set_task_done(&c, &b.tasks[0].id, false)
            .unwrap()
            .done_at
            .is_none());
        assert!(set_task_done(&c, "nope", true).is_err());
    }

    #[test]
    fn delete_removes_plan_and_tasks() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let a = space(&c, "A");
        let b = space(&c, "B");
        save_plan(&c, &a, &fields(), false, &[nt("2026-10-13", 0, "A")]).unwrap();
        save_plan(&c, &b, &fields(), false, &[nt("2026-10-13", 0, "B")]).unwrap();
        delete_plan(&c, &a).unwrap();
        assert!(get_plan(&c, &a).unwrap().is_none());
        assert!(list_tasks(&c, &a).unwrap().is_empty());
        assert_eq!(list_tasks(&c, &b).unwrap().len(), 1);
    }

    #[test]
    fn range_listing_joins_spaces_and_cascades_on_space_delete() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let a = space(&c, "Alpha");
        let b = space(&c, "Beta");
        save_plan(
            &c,
            &a,
            &fields(),
            false,
            &[nt("2026-10-12", 0, "early"), nt("2026-10-13", 0, "a1")],
        )
        .unwrap();
        save_plan(
            &c,
            &b,
            &fields(),
            false,
            &[nt("2026-10-13", 0, "b1"), nt("2026-10-20", 0, "late")],
        )
        .unwrap();
        let rows = tasks_between(&c, "2026-10-13", "2026-10-14").unwrap();
        assert_eq!(
            rows.iter()
                .map(|r| (r.space_name.as_str(), r.task.title.as_str()))
                .collect::<Vec<_>>(),
            vec![("Alpha", "a1"), ("Beta", "b1")]
        );
        assert!(!rows[0].space_icon.is_empty());
        models::delete_space(&c, &a).unwrap();
        assert!(get_plan(&c, &a).unwrap().is_none());
        assert_eq!(
            tasks_between(&c, "2026-10-01", "2026-12-01").unwrap().len(),
            2
        );
    }
}
