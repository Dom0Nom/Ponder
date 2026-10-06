//! Owns the active focus machine: persistence, event log, tick thread, window + tray sync.
use super::machine::{FocusConfig, FocusMachine, FocusState, Phase, PauseReason, Technique, Transition};
use crate::db::{new_id, now_ms, Db};
use crate::error::{invalid, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionSummary {
    pub id: String,
    pub space_id: Option<String>,
    pub technique: Technique,
    pub goal: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub focus_ms: i64,
    pub break_ms: i64,
    pub pauses: i64,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusEvent {
    pub id: i64,
    pub session_id: String,
    pub kind: String,
    pub at: i64,
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParkingItem {
    pub id: String,
    pub session_id: Option<String>,
    pub space_id: Option<String>,
    pub text: String,
    pub resolved: bool,
    pub created_at: i64,
}

/// What a command or tick changed; the runtime turns it into events and window/tray updates.
#[derive(Debug, Default)]
pub struct Outcome {
    pub state: Option<FocusState>,
    pub transitions: Vec<Transition>,
}

pub struct FocusService {
    db: Db,
    machine: Mutex<Option<FocusMachine>>,
}

fn no_session() -> crate::error::AppError {
    invalid("No focus session is running")
}

fn log_event(c: &Connection, session_id: &str, kind: &str, at: i64, data: Option<Value>) -> AppResult<()> {
    c.execute(
        "INSERT INTO focus_events (session_id, kind, at, data) VALUES (?1, ?2, ?3, ?4)",
        params![session_id, kind, at, data.map(|d| d.to_string())],
    )?;
    Ok(())
}

fn persist(c: &Connection, m: &FocusMachine, now: i64) -> AppResult<()> {
    let t = m.totals(now);
    c.execute(
        "UPDATE focus_sessions SET state = ?1, focus_ms = ?2, break_ms = ?3, pauses = ?4 WHERE id = ?5",
        params![serde_json::to_string(m)?, t.focus_ms, t.break_ms, t.pauses, m.session_id],
    )?;
    Ok(())
}

fn log_transitions(c: &Connection, m: &FocusMachine, trans: &[Transition], now: i64) -> AppResult<()> {
    for t in trans {
        log_event(
            c,
            &m.session_id,
            "phase",
            t.at,
            Some(json!({ "from": t.from, "to": t.to, "block": t.state.block })),
        )?;
        if t.auto_paused {
            log_event(c, &m.session_id, "auto_pause_sleep", t.at, Some(json!({ "gapMs": now - t.at })))?;
        }
    }
    Ok(())
}

fn finalize(c: &Connection, m: &mut FocusMachine, now: i64) -> AppResult<()> {
    let t = m.stop(now);
    log_event(c, &m.session_id, "end", now, None)?;
    c.execute(
        "UPDATE focus_sessions SET ended_at = ?1, focus_ms = ?2, break_ms = ?3, pauses = ?4, state = ?5 WHERE id = ?6",
        params![now, t.focus_ms, t.break_ms, t.pauses, serde_json::to_string(&*m)?, m.session_id],
    )?;
    Ok(())
}

fn summary_from_row(r: &Row) -> rusqlite::Result<FocusSessionSummary> {
    let technique: String = r.get("technique")?;
    Ok(FocusSessionSummary {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        technique: serde_json::from_value(Value::String(technique)).unwrap_or(Technique::Custom),
        goal: r.get("goal")?,
        started_at: r.get("started_at")?,
        ended_at: r.get("ended_at")?,
        focus_ms: r.get("focus_ms")?,
        break_ms: r.get("break_ms")?,
        pauses: r.get("pauses")?,
        summary: r.get("summary")?,
    })
}

fn get_summary(c: &Connection, id: &str) -> AppResult<FocusSessionSummary> {
    c.query_row("SELECT * FROM focus_sessions WHERE id = ?1", [id], summary_from_row)
        .optional()?
        .ok_or_else(|| crate::error::AppError::NotFound("focus session".into()))
}

fn parking_from_row(r: &Row) -> rusqlite::Result<ParkingItem> {
    Ok(ParkingItem {
        id: r.get("id")?,
        session_id: r.get("session_id")?,
        space_id: r.get("space_id")?,
        text: r.get("text")?,
        resolved: r.get::<_, i64>("resolved")? != 0,
        created_at: r.get("created_at")?,
    })
}

impl FocusService {
    pub fn new(db: Db) -> Self {
        FocusService { db, machine: Mutex::new(None) }
    }

    fn lock(&self) -> MutexGuard<'_, Option<FocusMachine>> {
        self.machine.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self, now: i64) -> Option<FocusState> {
        self.lock().as_ref().map(|m| m.snapshot(now))
    }

    pub fn is_break_locked(&self) -> bool {
        self.lock().as_ref().is_some_and(|m| m.is_break_locked())
    }

    /// Loads the session that was running when the app quit and catches it up to `now`.
    pub fn restore(&self, now: i64) -> AppResult<Outcome> {
        {
            let c = self.db.conn()?;
            let mut st = c.prepare("SELECT id, state FROM focus_sessions WHERE ended_at IS NULL ORDER BY started_at DESC")?;
            let rows: Vec<(String, String)> =
                st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
            let mut guard = self.lock();
            for (i, (id, state)) in rows.iter().enumerate() {
                let parsed = if i == 0 { serde_json::from_str::<FocusMachine>(state).ok() } else { None };
                match parsed {
                    Some(m) => *guard = Some(m),
                    None => {
                        log::warn!("closing stale focus session {id}");
                        c.execute("UPDATE focus_sessions SET ended_at = ?1 WHERE id = ?2", params![now, id])?;
                    }
                }
            }
        }
        self.tick(now)
    }

    /// Runs `op` on the active machine after catching it up to `now`; persists and logs everything.
    fn with_active(
        &self,
        now: i64,
        op: impl FnOnce(&Connection, &mut FocusMachine, &mut Vec<Transition>) -> AppResult<()>,
    ) -> AppResult<Outcome> {
        let mut guard = self.lock();
        // work on a copy so a failed op or write leaves the in-memory machine untouched
        let mut m = guard.clone().ok_or_else(no_session)?;
        let c = self.db.conn()?;
        let tx = c.unchecked_transaction()?;
        let mut trans = m.tick(now);
        log_transitions(&tx, &m, &trans, now)?;
        if m.phase != Phase::Done {
            op(&tx, &mut m, &mut trans)?;
        }
        if m.phase == Phase::Done {
            finalize(&tx, &mut m, now)?;
        } else {
            persist(&tx, &m, now)?;
        }
        tx.commit()?;
        *guard = (m.phase != Phase::Done).then_some(m);
        Ok(Outcome { state: guard.as_ref().map(|m| m.snapshot(now)), transitions: trans })
    }

    pub fn tick(&self, now: i64) -> AppResult<Outcome> {
        {
            let guard = self.lock();
            match guard.as_ref() {
                None => return Ok(Outcome::default()),
                Some(m) => {
                    let mut probe = m.clone();
                    if probe.tick(now).is_empty() && m.phase != Phase::Done {
                        return Ok(Outcome { state: Some(m.snapshot(now)), transitions: vec![] });
                    }
                }
            }
        }
        self.with_active(now, |_, _, _| Ok(()))
    }

    pub fn start(&self, config: FocusConfig, now: i64) -> AppResult<Outcome> {
        let mut guard = self.lock();
        if guard.is_some() {
            return Err(invalid("A focus session is already running"));
        }
        let m = FocusMachine::start(new_id(), &config, now)?;
        let c = self.db.conn()?;
        let tx = c.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO focus_sessions (id, space_id, technique, config, goal, state, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                m.session_id,
                m.space_id,
                m.technique.as_str(),
                serde_json::to_string(&config)?,
                m.goal,
                serde_json::to_string(&m)?,
                now
            ],
        )?;
        log_event(&tx, &m.session_id, "start", now, Some(json!({ "technique": m.technique, "goal": m.goal })))?;
        tx.commit()?;
        let state = m.snapshot(now);
        *guard = Some(m);
        Ok(Outcome {
            state: Some(state.clone()),
            transitions: vec![Transition { from: Phase::Done, to: Phase::Work, state, at: now, auto_paused: false }],
        })
    }

    pub fn pause(&self, now: i64) -> AppResult<Outcome> {
        self.with_active(now, |c, m, _| {
            if m.pause(now)? {
                log_event(c, &m.session_id, "pause", now, Some(json!({ "reason": "user" })))?;
            }
            Ok(())
        })
    }

    pub fn resume(&self, now: i64) -> AppResult<Outcome> {
        self.with_active(now, |c, m, _| {
            if m.resume(now)? {
                log_event(c, &m.session_id, "resume", now, None)?;
            }
            Ok(())
        })
    }

    pub fn need_app(&self, now: i64, reason: Option<String>) -> AppResult<Outcome> {
        self.with_active(now, |c, m, _| {
            if m.need_app(now)? {
                log_event(c, &m.session_id, "need_app_pause", now, Some(json!({ "reason": reason })))?;
            }
            Ok(())
        })
    }

    pub fn end_work(&self, now: i64) -> AppResult<Outcome> {
        self.with_active(now, |c, m, trans| {
            let t = m.end_work(now)?;
            log_transitions(c, m, std::slice::from_ref(&t), now)?;
            trans.push(t);
            Ok(())
        })
    }

    pub fn stop(&self, now: i64) -> AppResult<(FocusSessionSummary, Outcome)> {
        let mut guard = self.lock();
        let mut m = guard.clone().ok_or_else(no_session)?;
        let c = self.db.conn()?;
        let tx = c.unchecked_transaction()?;
        let mut trans = m.tick(now);
        log_transitions(&tx, &m, &trans, now)?;
        let from = m.phase;
        finalize(&tx, &mut m, now)?;
        if from != Phase::Done {
            trans.push(Transition { from, to: Phase::Done, state: m.snapshot(now), at: now, auto_paused: false });
        }
        let summary = get_summary(&tx, &m.session_id)?;
        tx.commit()?;
        *guard = None;
        Ok((summary, Outcome { state: None, transitions: trans }))
    }

    pub fn set_summary(&self, session_id: &str, summary: &str) -> AppResult<()> {
        self.db
            .conn()?
            .execute("UPDATE focus_sessions SET summary = ?1 WHERE id = ?2", params![summary, session_id])?;
        Ok(())
    }

    pub fn history(&self, space_id: Option<&str>) -> AppResult<Vec<FocusSessionSummary>> {
        let c = self.db.conn()?;
        let mut st = c.prepare(
            "SELECT * FROM focus_sessions WHERE (?1 IS NULL OR space_id = ?1) ORDER BY started_at DESC LIMIT 500",
        )?;
        let rows = st.query_map([space_id], summary_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn events(&self, session_id: &str) -> AppResult<Vec<FocusEvent>> {
        let c = self.db.conn()?;
        let mut st = c.prepare("SELECT id, session_id, kind, at, data FROM focus_events WHERE session_id = ?1 ORDER BY id")?;
        let rows = st.query_map([session_id], |r| {
            let data: Option<String> = r.get(4)?;
            Ok(FocusEvent {
                id: r.get(0)?,
                session_id: r.get(1)?,
                kind: r.get(2)?,
                at: r.get(3)?,
                data: data.and_then(|d| serde_json::from_str(&d).ok()),
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn parking_add(&self, text: &str, now: i64) -> AppResult<ParkingItem> {
        let text = text.trim();
        if text.is_empty() {
            return Err(invalid("Nothing to park"));
        }
        let guard = self.lock();
        let item = ParkingItem {
            id: new_id(),
            session_id: guard.as_ref().map(|m| m.session_id.clone()),
            space_id: guard.as_ref().and_then(|m| m.space_id.clone()),
            text: text.to_string(),
            resolved: false,
            created_at: now,
        };
        let c = self.db.conn()?;
        c.execute(
            "INSERT INTO parking_items (id, session_id, space_id, text, resolved, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![item.id, item.session_id, item.space_id, item.text, item.created_at],
        )?;
        if let Some(sid) = &item.session_id {
            log_event(&c, sid, "parking", now, Some(json!({ "text": item.text })))?;
        }
        Ok(item)
    }

    pub fn parking_list(&self, session_id: Option<&str>) -> AppResult<Vec<ParkingItem>> {
        let c = self.db.conn()?;
        let mut st = c.prepare(
            "SELECT * FROM parking_items WHERE (?1 IS NULL OR session_id = ?1) ORDER BY created_at, rowid",
        )?;
        let rows = st.query_map([session_id], parking_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn parking_resolve(&self, id: &str) -> AppResult<()> {
        self.db.conn()?.execute("UPDATE parking_items SET resolved = 1 WHERE id = ?1", [id])?;
        Ok(())
    }
}

// ---------- runtime: events, window, tray ----------

#[derive(Default)]
pub struct UiSync {
    locked: AtomicBool,
    last_fullscreen_at: AtomicI64,
    tray_title: Mutex<String>,
}

/// Emits events for an outcome and syncs window fullscreen + tray. Call without holding the service lock.
pub fn apply(app: &AppHandle, out: &Outcome) {
    for t in &out.transitions {
        let _ = app.emit("focus://transition", t);
    }
    let _ = app.emit("focus://tick", &out.state);
    sync_window(app, out.state.as_ref());
    super::tray::update(app, out.state.as_ref());
}

fn locked(state: Option<&FocusState>) -> bool {
    state.is_some_and(|s| s.phase.is_break() && s.pause_reason != Some(PauseReason::NeedApp))
}

fn sync_window(app: &AppHandle, state: Option<&FocusState>) {
    let Some(ui) = app.try_state::<UiSync>() else { return };
    let now_locked = locked(state);
    let was = ui.locked.swap(now_locked, Ordering::SeqCst);
    let Some(w) = app.get_webview_window("main") else { return };
    if now_locked && !was {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = w.set_fullscreen(true);
        ui.last_fullscreen_at.store(now_ms(), Ordering::SeqCst);
    } else if !now_locked && was {
        let _ = w.set_fullscreen(false);
    }
}

/// Re-enters fullscreen if the user left it during a locked break. Debounced so it doesn't fight the
/// macOS fullscreen animation.
pub fn enforce_fullscreen(app: &AppHandle) {
    let Some(ui) = app.try_state::<UiSync>() else { return };
    if !ui.locked.load(Ordering::SeqCst) {
        return;
    }
    let now = now_ms();
    if now - ui.last_fullscreen_at.load(Ordering::SeqCst) < 2000 {
        return;
    }
    let Some(w) = app.get_webview_window("main") else { return };
    if w.is_minimized().unwrap_or(false) {
        let _ = w.unminimize();
    }
    if !w.is_fullscreen().unwrap_or(true) {
        ui.last_fullscreen_at.store(now, Ordering::SeqCst);
        let _ = w.set_fullscreen(true);
    }
}

pub fn tray_title(state: Option<&FocusState>) -> String {
    let Some(s) = state else { return String::new() };
    let ms = s.remaining_ms.unwrap_or(s.elapsed_ms);
    let secs = (ms + 999) / 1000;
    let clock = if secs >= 3600 {
        format!("{}:{:02}:{:02}", secs / 3600, (secs % 3600) / 60, secs % 60)
    } else {
        format!("{:02}:{:02}", secs / 60, secs % 60)
    };
    let icon = if s.paused {
        "⏸"
    } else if s.phase.is_break() {
        "☕"
    } else {
        "◷"
    };
    format!("{icon} {clock}")
}

pub fn set_tray_title(app: &AppHandle, title: String) -> bool {
    let Some(ui) = app.try_state::<UiSync>() else { return false };
    let mut cur = ui.tray_title.lock().unwrap_or_else(|e| e.into_inner());
    if *cur == title {
        return false;
    }
    *cur = title;
    true
}

pub fn spawn_ticker(app: AppHandle) {
    std::thread::Builder::new()
        .name("focus-tick".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(1000 - (now_ms() % 1000) as u64 + 5));
            let svc = app.state::<FocusService>();
            match svc.tick(now_ms()) {
                Ok(out) => apply(&app, &out),
                Err(e) => log::error!("focus tick failed: {e}"),
            }
            enforce_fullscreen(&app);
        })
        .expect("spawn focus tick thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::focus::machine::SLEEP_GRACE_MS;

    const T0: i64 = 1_700_000_000_000;
    const MIN: i64 = 60_000;

    fn custom(work: f64, brk: f64) -> FocusConfig {
        FocusConfig { work_mins: Some(work), break_mins: Some(brk), ..FocusConfig::new(Technique::Custom) }
    }

    fn kinds(svc: &FocusService, id: &str) -> Vec<String> {
        svc.events(id).unwrap().into_iter().map(|e| e.kind).collect()
    }

    #[test]
    fn persists_and_restores_active_session() {
        let (db, _dir) = test_db();
        let svc = FocusService::new(db.clone());
        let out = svc.start(custom(1.0, 2.0), T0).unwrap();
        let id = out.state.unwrap().session_id;
        assert!(svc.start(custom(1.0, 1.0), T0).is_err(), "only one session at a time");
        svc.parking_add("buy milk", T0 + 1000).unwrap();
        let out = svc.tick(T0 + MIN + 500).unwrap();
        assert_eq!(out.transitions.len(), 1);
        svc.need_app(T0 + MIN + 2000, Some("look up notes".into())).unwrap();

        // app restarts
        let svc2 = FocusService::new(db.clone());
        let out = svc2.restore(T0 + 5 * MIN).unwrap();
        let st = out.state.expect("restored");
        assert_eq!(st.session_id, id);
        assert_eq!(st.phase, Phase::Break);
        assert_eq!(st.pause_reason, Some(PauseReason::NeedApp));
        assert_eq!(st.remaining_ms, Some(2 * MIN - 2000));
        assert!(!svc2.is_break_locked());
        assert_eq!(svc.snapshot(T0 + 5 * MIN), Some(st));

        let events = svc2.events(&id).unwrap();
        let need = events.iter().find(|e| e.kind == "need_app_pause").unwrap();
        assert_eq!(need.data.as_ref().unwrap()["reason"], "look up notes");
        assert_eq!(kinds(&svc2, &id), vec!["start", "parking", "phase", "need_app_pause"]);

        let items = svc2.parking_list(Some(&id)).unwrap();
        assert_eq!(items.len(), 1);
        svc2.parking_resolve(&items[0].id).unwrap();
        assert!(svc2.parking_list(None).unwrap()[0].resolved);

        svc2.resume(T0 + 6 * MIN).unwrap();
        assert!(svc2.is_break_locked());
        let (sum, out) = svc2.stop(T0 + 7 * MIN).unwrap();
        assert_eq!(out.transitions.last().unwrap().to, Phase::Done);
        assert_eq!(sum.ended_at, Some(T0 + 7 * MIN));
        assert_eq!(sum.focus_ms, MIN);
        assert_eq!(sum.break_ms, MIN + 2000);
        assert_eq!(sum.pauses, 1);
        assert!(svc2.snapshot(T0 + 8 * MIN).is_none());
        svc2.set_summary(&id, "Good session").unwrap();
        let hist = svc2.history(None).unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(hist[0].summary.as_deref(), Some("Good session"));
        assert_eq!(*kinds(&svc2, &id).last().unwrap(), "end");

        let svc3 = FocusService::new(db);
        assert!(svc3.restore(T0 + 9 * MIN).unwrap().state.is_none());
        assert!(svc3.stop(T0 + 9 * MIN).is_err());
    }

    #[test]
    fn restore_after_long_quit_pauses_at_block_start() {
        let (db, _dir) = test_db();
        let svc = FocusService::new(db.clone());
        let id = svc.start(custom(10.0, 5.0), T0).unwrap().state.unwrap().session_id;
        drop(svc);
        let svc = FocusService::new(db);
        let out = svc.restore(T0 + 60 * MIN).unwrap();
        assert_eq!(out.transitions.len(), 2);
        let st = out.state.unwrap();
        assert!(st.paused);
        assert_eq!(st.phase_started_at, T0 + 15 * MIN);
        assert_eq!(st.total_focus_ms, 10 * MIN);
        assert_eq!(kinds(&svc, &id), vec!["start", "phase", "phase", "auto_pause_sleep"]);
        assert!(60 * MIN - 15 * MIN > SLEEP_GRACE_MS);
    }

    #[test]
    fn failed_command_leaves_machine_untouched() {
        let (db, _dir) = test_db();
        let svc = FocusService::new(db);
        let id = svc.start(custom(1.0, 1.0), T0).unwrap().state.unwrap().session_id;
        assert!(svc.pause(T0 + MIN + 500).is_err(), "the block just ended; breaks can't be paused");
        assert_eq!(svc.snapshot(T0 + MIN + 500).unwrap().phase, Phase::Work);
        let out = svc.tick(T0 + MIN + 600).unwrap();
        assert_eq!(out.transitions.len(), 1);
        assert_eq!(kinds(&svc, &id), vec!["start", "phase"]);
    }

    #[test]
    fn timebox_finalizes_session_when_done() {
        let (db, _dir) = test_db();
        let svc = FocusService::new(db);
        let cfg = FocusConfig { work_mins: Some(2.0), break_mins: Some(1.0), ..FocusConfig::new(Technique::Timebox) };
        let id = svc.start(cfg, T0).unwrap().state.unwrap().session_id;
        let out = svc.end_work(T0 + MIN).unwrap();
        assert_eq!(out.transitions[0].to, Phase::Break);
        let out = svc.tick(T0 + 2 * MIN).unwrap();
        assert_eq!(out.transitions.last().unwrap().to, Phase::Done);
        assert!(out.state.is_none());
        let s = &svc.history(None).unwrap()[0];
        assert_eq!((s.id.as_str(), s.ended_at, s.focus_ms, s.break_ms), (id.as_str(), Some(T0 + 2 * MIN), MIN, MIN));
        assert!(svc.pause(T0 + 3 * MIN).is_err());
    }
}
