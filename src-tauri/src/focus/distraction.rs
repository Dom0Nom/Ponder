//! Distraction nudge: during a work block, notices when an app the learner marked as distracting
//! stays frontmost and nudges them back (notification + event). Polls the frontmost app; no root,
//! no accessibility permission.
use super::machine::{FocusState, Phase};
use crate::db::models::get_setting;
use crate::error::AppResult;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const SETTINGS_KEY: &str = "focus.distraction";
const POLL_MS: i64 = 2_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionPrefs {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub apps: Vec<AppInfo>,
    #[serde(default = "default_grace")]
    pub grace_sec: u32,
}

fn default_grace() -> u32 {
    15
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Nudge {
    pub app: AppInfo,
    pub session_id: String,
    pub remaining_ms: Option<i64>,
    pub count: u32,
    pub at: i64,
}

/// Pure decision logic, fed one observation per poll.
#[derive(Debug, Default)]
pub struct Tracker {
    since: Option<(String, i64)>,
    last_nudge: HashMap<String, i64>,
    session: Option<String>,
    count: u32,
    last_poll: i64,
}

pub const COOLDOWN_MS: i64 = 3 * 60_000;

impl Tracker {
    pub fn due(&self, now: i64) -> bool {
        now - self.last_poll >= POLL_MS
    }

    /// `front` is the frontmost app, `None` when it can't be read.
    pub fn observe(
        &mut self,
        now: i64,
        state: Option<&FocusState>,
        front: Option<&AppInfo>,
        prefs: &DistractionPrefs,
    ) -> Option<Nudge> {
        self.last_poll = now;
        let active = state.filter(|s| s.phase == Phase::Work && !s.paused);
        let Some(s) = active.filter(|_| prefs.enabled) else {
            self.since = None;
            return None;
        };
        if self.session.as_deref() != Some(&s.session_id) {
            self.session = Some(s.session_id.clone());
            self.count = 0;
            self.last_nudge.clear();
            self.since = None;
        }
        let blocked = front.filter(|f| prefs.apps.iter().any(|a| a.id == f.id));
        let Some(app) = blocked else {
            self.since = None;
            return None;
        };
        let since = match &self.since {
            Some((id, t)) if *id == app.id => *t,
            _ => {
                self.since = Some((app.id.clone(), now));
                now
            }
        };
        if now - since < i64::from(prefs.grace_sec) * 1000 {
            return None;
        }
        if self
            .last_nudge
            .get(&app.id)
            .is_some_and(|t| now - t < COOLDOWN_MS)
        {
            return None;
        }
        self.last_nudge.insert(app.id.clone(), now);
        self.count += 1;
        Some(Nudge {
            app: app.clone(),
            session_id: s.session_id.clone(),
            remaining_ms: s.remaining_ms,
            count: self.count,
            at: now,
        })
    }
}

#[derive(Default)]
pub struct DistractionService {
    tracker: Mutex<Tracker>,
}

fn read_prefs(app: &AppHandle) -> Option<DistractionPrefs> {
    let state = app.try_state::<AppState>()?;
    let c = state.db.conn().ok()?;
    let v = get_setting(&c, SETTINGS_KEY).ok()??;
    serde_json::from_value(v).ok()
}

/// Called on every focus tick.
pub fn sync(app: &AppHandle, state: Option<&FocusState>) {
    let Some(svc) = app.try_state::<DistractionService>() else {
        return;
    };
    let now = crate::db::now_ms();
    let mut t = svc.tracker.lock().unwrap_or_else(|e| e.into_inner());
    if !t.due(now) {
        return;
    }
    let working = state.is_some_and(|s| s.phase == Phase::Work && !s.paused);
    let prefs = if working { read_prefs(app) } else { None };
    let front = prefs
        .as_ref()
        .filter(|p| p.enabled && !p.apps.is_empty())
        .and_then(|_| platform::frontmost());
    let nudge = t.observe(
        now,
        state,
        front.as_ref(),
        &prefs.unwrap_or(DistractionPrefs {
            enabled: false,
            apps: vec![],
            grace_sec: 15,
        }),
    );
    drop(t);
    if let Some(n) = nudge {
        notify(app, &n);
    }
}

fn notify(app: &AppHandle, n: &Nudge) {
    if let Some(focus) = app.try_state::<super::service::FocusService>() {
        if let Err(e) = focus.log_distraction(&n.session_id, &n.app.name, n.at) {
            log::warn!("logging distraction failed: {e}");
        }
    }
    let _ = app.emit("focus://distraction", n);
    let mins = n.remaining_ms.map(|ms| (ms + 59_999) / 60_000);
    let body = match mins {
        Some(m) if m > 0 => format!(
            "{} is open during your focus block. {m} min left. Back to it?",
            n.app.name
        ),
        _ => format!(
            "{} is open during your focus block. Back to it?",
            n.app.name
        ),
    };
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app
        .notification()
        .builder()
        .title("Ponder")
        .body(body)
        .show()
    {
        log::warn!("distraction notification failed: {e}");
    }
}

#[tauri::command]
pub async fn running_apps() -> AppResult<Vec<AppInfo>> {
    Ok(platform::running())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::AppInfo;
    use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication, NSWorkspace};

    fn info(app: &NSRunningApplication) -> Option<AppInfo> {
        let id = app.bundleIdentifier()?.to_string();
        let name = app
            .localizedName()
            .map(|n| n.to_string())
            .unwrap_or_else(|| id.clone());
        Some(AppInfo { id, name })
    }

    pub fn frontmost() -> Option<AppInfo> {
        let ws = NSWorkspace::sharedWorkspace();
        ws.frontmostApplication().and_then(|a| info(&a))
    }

    pub fn running() -> Vec<AppInfo> {
        let ws = NSWorkspace::sharedWorkspace();
        let own = NSRunningApplication::currentApplication()
            .bundleIdentifier()
            .map(|s| s.to_string());
        let mut apps: Vec<AppInfo> = ws
            .runningApplications()
            .iter()
            .filter(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular)
            .filter_map(|a| info(&a))
            .filter(|a| own.as_deref() != Some(a.id.as_str()))
            .collect();
        apps.sort_by_key(|a| a.name.to_lowercase());
        apps.dedup_by(|a, b| a.id == b.id);
        apps
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::AppInfo;
    pub fn frontmost() -> Option<AppInfo> {
        None
    }
    pub fn running() -> Vec<AppInfo> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::focus::machine::{Energy, Technique};

    fn state(phase: Phase, paused: bool, session: &str) -> FocusState {
        FocusState {
            session_id: session.into(),
            space_id: None,
            technique: Technique::Pomodoro,
            goal: None,
            phase,
            block: 1,
            phase_started_at: 0,
            phase_duration_ms: Some(25 * 60_000),
            elapsed_ms: 0,
            remaining_ms: Some(10 * 60_000),
            paused,
            pause_reason: None,
            pause_count: 0,
            need_app_count: 0,
            total_focus_ms: 0,
            total_break_ms: 0,
            check_in_mins: 0,
            energy: Energy::Normal,
            now: 0,
        }
    }

    fn app(id: &str) -> AppInfo {
        AppInfo {
            id: id.into(),
            name: id.to_uppercase(),
        }
    }

    fn prefs() -> DistractionPrefs {
        DistractionPrefs {
            enabled: true,
            apps: vec![app("com.game")],
            grace_sec: 10,
        }
    }

    #[test]
    fn nudges_after_grace_then_waits_for_cooldown() {
        let mut t = Tracker::default();
        let s = state(Phase::Work, false, "s1");
        let g = app("com.game");
        assert!(t.observe(0, Some(&s), Some(&g), &prefs()).is_none());
        assert!(t.observe(9_000, Some(&s), Some(&g), &prefs()).is_none());
        let n = t
            .observe(10_000, Some(&s), Some(&g), &prefs())
            .expect("nudge");
        assert_eq!(
            (n.app.id.as_str(), n.count, n.remaining_ms),
            ("com.game", 1, Some(600_000))
        );
        assert!(t.observe(12_000, Some(&s), Some(&g), &prefs()).is_none());
        assert!(t
            .observe(10_000 + COOLDOWN_MS - 1, Some(&s), Some(&g), &prefs())
            .is_none());
        assert_eq!(
            t.observe(10_000 + COOLDOWN_MS, Some(&s), Some(&g), &prefs())
                .map(|n| n.count),
            Some(2)
        );
    }

    #[test]
    fn switching_away_resets_the_grace_period() {
        let mut t = Tracker::default();
        let s = state(Phase::Work, false, "s1");
        let (g, ok) = (app("com.game"), app("com.notes"));
        t.observe(0, Some(&s), Some(&g), &prefs());
        t.observe(8_000, Some(&s), Some(&ok), &prefs());
        assert!(t.observe(9_000, Some(&s), Some(&g), &prefs()).is_none());
        assert!(t.observe(18_000, Some(&s), Some(&g), &prefs()).is_none());
        assert!(t.observe(19_000, Some(&s), Some(&g), &prefs()).is_some());
    }

    #[test]
    fn quiet_on_breaks_pauses_disabled_and_unlisted_apps() {
        let g = app("com.game");
        for (s, p) in [
            (Some(state(Phase::Break, false, "s1")), prefs()),
            (Some(state(Phase::Work, true, "s1")), prefs()),
            (None, prefs()),
            (
                Some(state(Phase::Work, false, "s1")),
                DistractionPrefs {
                    enabled: false,
                    ..prefs()
                },
            ),
            (
                Some(state(Phase::Work, false, "s1")),
                DistractionPrefs {
                    apps: vec![app("com.other")],
                    ..prefs()
                },
            ),
        ] {
            let mut t = Tracker::default();
            assert!(t.observe(0, s.as_ref(), Some(&g), &p).is_none());
            assert!(t.observe(60_000, s.as_ref(), Some(&g), &p).is_none());
        }
    }

    #[test]
    fn a_new_session_resets_the_count() {
        let mut t = Tracker::default();
        let g = app("com.game");
        t.observe(
            0,
            Some(&state(Phase::Work, false, "s1")),
            Some(&g),
            &prefs(),
        );
        assert_eq!(
            t.observe(
                10_000,
                Some(&state(Phase::Work, false, "s1")),
                Some(&g),
                &prefs()
            )
            .map(|n| n.count),
            Some(1)
        );
        t.observe(
            20_000,
            Some(&state(Phase::Work, false, "s2")),
            Some(&g),
            &prefs(),
        );
        assert_eq!(
            t.observe(
                30_000,
                Some(&state(Phase::Work, false, "s2")),
                Some(&g),
                &prefs()
            )
            .map(|n| n.count),
            Some(1)
        );
    }
}
