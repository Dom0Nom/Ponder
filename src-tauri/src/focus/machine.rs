//! Pure focus-timer state machine. No I/O; every method takes the wall clock `now` (ms).
//! State is stored as timestamps, so remaining time is always derived from `now`.
use crate::error::{invalid, AppResult};
use serde::{Deserialize, Serialize};

const MIN: i64 = 60_000;
/// A break→work boundary found later than this was slept through (or the app was closed).
pub const SLEEP_GRACE_MS: i64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Technique {
    #[serde(rename = "pomodoro")]
    Pomodoro,
    #[serde(rename = "52-17")]
    FiftyTwoSeventeen,
    #[serde(rename = "flowtime")]
    Flowtime,
    #[serde(rename = "timebox")]
    Timebox,
    #[serde(rename = "custom")]
    Custom,
}

impl Technique {
    pub fn as_str(self) -> &'static str {
        match self {
            Technique::Pomodoro => "pomodoro",
            Technique::FiftyTwoSeventeen => "52-17",
            Technique::Flowtime => "flowtime",
            Technique::Timebox => "timebox",
            Technique::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Work,
    Break,
    LongBreak,
    Done,
}

impl Phase {
    pub fn is_break(self) -> bool {
        matches!(self, Phase::Break | Phase::LongBreak)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PauseReason {
    User,
    NeedApp,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Energy {
    #[default]
    Normal,
    Low,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusConfig {
    #[serde(default)]
    pub space_id: Option<String>,
    pub technique: Technique,
    #[serde(default)]
    pub goal: Option<String>,
    #[serde(default)]
    pub work_mins: Option<f64>,
    #[serde(default)]
    pub break_mins: Option<f64>,
    #[serde(default)]
    pub long_break_mins: Option<f64>,
    #[serde(default)]
    pub cycles_before_long: Option<f64>,
    #[serde(default)]
    pub check_in_mins: Option<f64>,
    #[serde(default)]
    pub energy: Energy,
}

#[cfg(test)]
impl FocusConfig {
    pub fn new(technique: Technique) -> Self {
        FocusConfig {
            space_id: None,
            technique,
            goal: None,
            work_mins: None,
            break_mins: None,
            long_break_mins: None,
            cycles_before_long: None,
            check_in_mins: None,
            energy: Energy::Normal,
        }
    }
}

/// Mirrors TS `FocusState`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusState {
    pub session_id: String,
    pub space_id: Option<String>,
    pub technique: Technique,
    pub goal: Option<String>,
    pub phase: Phase,
    pub block: u32,
    pub phase_started_at: i64,
    pub phase_duration_ms: Option<i64>,
    pub elapsed_ms: i64,
    pub remaining_ms: Option<i64>,
    pub paused: bool,
    pub pause_reason: Option<PauseReason>,
    pub pause_count: u32,
    pub need_app_count: u32,
    pub total_focus_ms: i64,
    pub total_break_ms: i64,
    pub check_in_mins: u32,
    pub energy: Energy,
    pub now: i64,
}

/// Serializes as TS `FocusTransition` ({from, to, state}); `at`/`auto_paused` are internal.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Transition {
    pub from: Phase,
    pub to: Phase,
    pub state: FocusState,
    #[serde(skip)]
    pub at: i64,
    /// the new work block began during a sleep gap and was paused at its start
    #[serde(skip)]
    pub auto_paused: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Totals {
    pub focus_ms: i64,
    pub break_ms: i64,
    pub pauses: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusMachine {
    pub session_id: String,
    pub space_id: Option<String>,
    pub technique: Technique,
    pub goal: Option<String>,
    pub work_ms: Option<i64>,
    pub break_ms: i64,
    pub long_break_ms: i64,
    pub cycles_before_long: u32,
    pub check_in_mins: u32,
    #[serde(default)]
    pub energy: Energy,
    pub started_at: i64,
    pub phase: Phase,
    pub block: u32,
    pub phase_started_at: i64,
    pub phase_duration_ms: Option<i64>,
    pub paused_at: Option<i64>,
    pub paused_total_ms: i64,
    pub pause_reason: Option<PauseReason>,
    pub pause_count: u32,
    pub need_app_count: u32,
    /// totals of completed phases
    pub focus_done_ms: i64,
    pub break_done_ms: i64,
}

fn mins_to_ms(v: Option<f64>, default: f64, what: &str) -> AppResult<i64> {
    let m = v.unwrap_or(default);
    if !m.is_finite() || m <= 0.0 || m > 24.0 * 60.0 {
        return Err(invalid(format!("{what} must be between 1 second and 24 hours")));
    }
    let ms = (m * MIN as f64).round() as i64;
    if ms < 1000 {
        return Err(invalid(format!("{what} must be between 1 second and 24 hours")));
    }
    Ok(ms)
}

impl FocusMachine {
    pub fn start(session_id: String, cfg: &FocusConfig, now: i64) -> AppResult<Self> {
        let (work, brk, long) = match cfg.technique {
            Technique::Pomodoro => (
                Some(mins_to_ms(cfg.work_mins, 25.0, "Focus length")?),
                mins_to_ms(cfg.break_mins, 5.0, "Break length")?,
                mins_to_ms(cfg.long_break_mins, 15.0, "Long break length")?,
            ),
            Technique::FiftyTwoSeventeen => (Some(52 * MIN), 17 * MIN, 17 * MIN),
            Technique::Flowtime => (None, 0, 0),
            Technique::Timebox | Technique::Custom => {
                let brk = mins_to_ms(cfg.break_mins, 5.0, "Break length")?;
                let long = match cfg.long_break_mins {
                    Some(_) => mins_to_ms(cfg.long_break_mins, 5.0, "Long break length")?,
                    None => brk,
                };
                (Some(mins_to_ms(cfg.work_mins, 30.0, "Focus length")?), brk, long)
            }
        };
        let cycles = cfg.cycles_before_long.unwrap_or(4.0);
        let cycles = if cycles.is_finite() { cycles.round().clamp(1.0, 100.0) as u32 } else { 4 };
        let check_in = cfg.check_in_mins.unwrap_or(0.0);
        let check_in = if check_in.is_finite() { check_in.round().clamp(0.0, 600.0) as u32 } else { 0 };
        let clean = |s: &Option<String>| s.as_ref().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
        Ok(FocusMachine {
            session_id,
            space_id: clean(&cfg.space_id),
            technique: cfg.technique,
            goal: clean(&cfg.goal),
            work_ms: work,
            break_ms: brk,
            long_break_ms: long,
            cycles_before_long: cycles,
            check_in_mins: check_in,
            energy: cfg.energy,
            started_at: now,
            phase: Phase::Work,
            block: 1,
            phase_started_at: now,
            phase_duration_ms: work,
            paused_at: None,
            paused_total_ms: 0,
            pause_reason: None,
            pause_count: 0,
            need_app_count: 0,
            focus_done_ms: 0,
            break_done_ms: 0,
        })
    }

    pub fn is_paused(&self) -> bool {
        self.paused_at.is_some()
    }

    /// A break is running and the user hasn't asked for the app.
    pub fn is_break_locked(&self) -> bool {
        self.phase.is_break() && self.pause_reason != Some(PauseReason::NeedApp)
    }

    fn raw_elapsed(&self, now: i64) -> i64 {
        if self.phase == Phase::Done {
            return 0;
        }
        let end = self.paused_at.unwrap_or(now);
        (end - self.phase_started_at - self.paused_total_ms).max(0)
    }

    fn elapsed(&self, now: i64) -> i64 {
        let el = self.raw_elapsed(now);
        match self.phase_duration_ms {
            Some(d) => el.min(d),
            None => el,
        }
    }

    fn enter(&mut self, phase: Phase, at: i64, duration: Option<i64>) {
        self.phase = phase;
        self.phase_started_at = at;
        self.phase_duration_ms = duration;
        self.paused_at = None;
        self.paused_total_ms = 0;
        self.pause_reason = None;
    }

    fn next_break(&self, worked_ms: i64) -> (Phase, i64) {
        match self.technique {
            Technique::Flowtime => (Phase::Break, (((worked_ms as f64) / 5.0).round() as i64).max(MIN)),
            Technique::Pomodoro | Technique::Custom if self.block.is_multiple_of(self.cycles_before_long) => {
                (Phase::LongBreak, self.long_break_ms)
            }
            _ => (Phase::Break, self.break_ms),
        }
    }

    /// Ends the current phase at `at`, crediting `spent` ms, and enters the next one.
    fn complete_phase(&mut self, at: i64, spent: i64) {
        if self.phase == Phase::Work {
            self.focus_done_ms += spent;
            let (p, d) = self.next_break(spent);
            self.enter(p, at, Some(d));
        } else {
            self.break_done_ms += spent;
            if self.technique == Technique::Timebox {
                self.enter(Phase::Done, at, None);
            } else {
                self.block += 1;
                let w = self.work_ms;
                self.enter(Phase::Work, at, w);
            }
        }
    }

    /// Applies every phase boundary that has passed, each at its exact timestamp.
    pub fn tick(&mut self, now: i64) -> Vec<Transition> {
        let mut out = Vec::new();
        loop {
            if self.is_paused() || self.phase == Phase::Done {
                break;
            }
            let Some(dur) = self.phase_duration_ms else { break };
            let boundary = self.phase_started_at + self.paused_total_ms + dur;
            if now < boundary {
                break;
            }
            let from = self.phase;
            self.complete_phase(boundary, dur);
            let mut auto_paused = false;
            if self.phase == Phase::Work && now - boundary > SLEEP_GRACE_MS {
                self.paused_at = Some(boundary);
                self.pause_reason = Some(PauseReason::User);
                auto_paused = true;
            }
            out.push(Transition { from, to: self.phase, state: self.snapshot(boundary), at: boundary, auto_paused });
        }
        if let Some(last) = out.last_mut() {
            last.state = self.snapshot(now);
        }
        out
    }

    fn require_active(&self) -> AppResult<()> {
        if self.phase == Phase::Done {
            return Err(invalid("No focus session is running"));
        }
        Ok(())
    }

    pub fn pause(&mut self, now: i64) -> AppResult<bool> {
        self.require_active()?;
        if self.phase != Phase::Work {
            return Err(invalid("Breaks can only be paused with “I need the app”"));
        }
        if self.is_paused() {
            return Ok(false);
        }
        self.paused_at = Some(now);
        self.pause_reason = Some(PauseReason::User);
        self.pause_count += 1;
        Ok(true)
    }

    pub fn resume(&mut self, now: i64) -> AppResult<bool> {
        self.require_active()?;
        let Some(p) = self.paused_at else { return Ok(false) };
        self.paused_total_ms += (now - p).max(0);
        self.paused_at = None;
        self.pause_reason = None;
        Ok(true)
    }

    /// The only way to interrupt a break.
    pub fn need_app(&mut self, now: i64) -> AppResult<bool> {
        self.require_active()?;
        if !self.phase.is_break() {
            return Err(invalid("Not on a break"));
        }
        if self.is_paused() {
            return Ok(false);
        }
        self.paused_at = Some(now);
        self.pause_reason = Some(PauseReason::NeedApp);
        self.pause_count += 1;
        self.need_app_count += 1;
        Ok(true)
    }

    /// Ends the current work block now and starts its break.
    pub fn end_work(&mut self, now: i64) -> AppResult<Transition> {
        self.require_active()?;
        if self.phase != Phase::Work {
            return Err(invalid("Not in a focus block"));
        }
        if let Some(p) = self.paused_at {
            self.paused_total_ms += (now - p).max(0);
            self.paused_at = None;
        }
        let worked = self.elapsed(now);
        self.complete_phase(now, worked);
        Ok(Transition { from: Phase::Work, to: self.phase, state: self.snapshot(now), at: now, auto_paused: false })
    }

    pub fn stop(&mut self, now: i64) -> Totals {
        let st = self.snapshot(now);
        self.focus_done_ms = st.total_focus_ms;
        self.break_done_ms = st.total_break_ms;
        self.enter(Phase::Done, now, None);
        Totals { focus_ms: st.total_focus_ms, break_ms: st.total_break_ms, pauses: self.pause_count }
    }

    pub fn totals(&self, now: i64) -> Totals {
        let st = self.snapshot(now);
        Totals { focus_ms: st.total_focus_ms, break_ms: st.total_break_ms, pauses: self.pause_count }
    }

    pub fn snapshot(&self, now: i64) -> FocusState {
        let el = self.elapsed(now);
        FocusState {
            session_id: self.session_id.clone(),
            space_id: self.space_id.clone(),
            technique: self.technique,
            goal: self.goal.clone(),
            phase: self.phase,
            block: self.block,
            phase_started_at: self.phase_started_at,
            phase_duration_ms: self.phase_duration_ms,
            elapsed_ms: el,
            remaining_ms: self.phase_duration_ms.map(|d| (d - el).max(0)),
            paused: self.is_paused(),
            pause_reason: self.pause_reason,
            pause_count: self.pause_count,
            need_app_count: self.need_app_count,
            total_focus_ms: self.focus_done_ms + if self.phase == Phase::Work { el } else { 0 },
            total_break_ms: self.break_done_ms + if self.phase.is_break() { el } else { 0 },
            check_in_mins: self.check_in_mins,
            energy: self.energy,
            now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_700_000_000_000;
    const S: i64 = 1000;

    fn machine(cfg: FocusConfig) -> FocusMachine {
        FocusMachine::start("s1".into(), &cfg, T0).unwrap()
    }

    fn custom(work: f64, brk: f64) -> FocusConfig {
        FocusConfig { work_mins: Some(work), break_mins: Some(brk), ..FocusConfig::new(Technique::Custom) }
    }

    /// ticks once a second from `from` to `to` (inclusive), collecting transitions
    fn run(m: &mut FocusMachine, from: i64, to: i64) -> Vec<Transition> {
        let mut out = Vec::new();
        let mut t = from;
        while t <= to {
            out.extend(m.tick(t));
            t += S;
        }
        out
    }

    #[test]
    fn pomodoro_long_break_after_four_blocks() {
        let mut m = machine(FocusConfig::new(Technique::Pomodoro));
        let trans = run(&mut m, T0, T0 + (4 * 25 + 3 * 5 + 15) * MIN);
        let seq: Vec<(Phase, Phase)> = trans.iter().map(|t| (t.from, t.to)).collect();
        use Phase::*;
        assert_eq!(
            seq,
            vec![
                (Work, Break),
                (Break, Work),
                (Work, Break),
                (Break, Work),
                (Work, Break),
                (Break, Work),
                (Work, LongBreak),
                (LongBreak, Work),
            ]
        );
        // exact boundaries, no drift
        assert_eq!(trans[0].at, T0 + 25 * MIN);
        assert_eq!(trans[1].at, T0 + 30 * MIN);
        assert_eq!(trans[6].at, T0 + (4 * 25 + 3 * 5) * MIN);
        assert_eq!(trans[7].at, T0 + (4 * 25 + 3 * 5 + 15) * MIN);
        assert_eq!(m.block, 5);
        let st = m.snapshot(T0 + (4 * 25 + 3 * 5 + 15) * MIN);
        assert_eq!(st.total_focus_ms, 100 * MIN);
        assert_eq!(st.total_break_ms, 30 * MIN);
        assert!(trans.iter().all(|t| !t.auto_paused));
    }

    #[test]
    fn pomodoro_overrides() {
        let cfg = FocusConfig {
            work_mins: Some(10.0),
            break_mins: Some(2.0),
            long_break_mins: Some(7.0),
            cycles_before_long: Some(2.0),
            ..FocusConfig::new(Technique::Pomodoro)
        };
        let mut m = machine(cfg);
        let tr = run(&mut m, T0, T0 + 24 * MIN);
        assert_eq!(tr.iter().map(|t| t.to).collect::<Vec<_>>(), vec![Phase::Break, Phase::Work, Phase::LongBreak]);
        assert_eq!(m.phase_duration_ms, Some(7 * MIN));
    }

    #[test]
    fn pause_excludes_time() {
        let mut m = machine(custom(10.0, 2.0));
        m.tick(T0 + 4 * MIN);
        assert!(m.pause(T0 + 4 * MIN).unwrap());
        assert!(!m.pause(T0 + 5 * MIN).unwrap());
        let st = m.snapshot(T0 + 30 * MIN);
        assert_eq!(st.elapsed_ms, 4 * MIN);
        assert_eq!(st.remaining_ms, Some(6 * MIN));
        assert!(m.tick(T0 + 30 * MIN).is_empty());
        assert!(m.resume(T0 + 30 * MIN).unwrap());
        assert!(m.tick(T0 + 35 * MIN).is_empty());
        let tr = m.tick(T0 + 36 * MIN);
        assert_eq!(tr.len(), 1);
        assert_eq!(tr[0].at, T0 + 36 * MIN);
        assert_eq!(tr[0].state.total_focus_ms, 10 * MIN);
        assert_eq!(m.snapshot(T0 + 36 * MIN).pause_count, 1);
    }

    #[test]
    fn need_app_only_on_break_and_counted() {
        let mut m = machine(custom(1.0, 5.0));
        assert!(m.need_app(T0).is_err());
        m.tick(T0 + MIN);
        assert_eq!(m.phase, Phase::Break);
        assert!(m.is_break_locked());
        assert!(m.pause(T0 + MIN).is_err(), "breaks can't be paused normally");
        assert!(m.need_app(T0 + 2 * MIN).unwrap());
        assert!(!m.is_break_locked());
        assert!(!m.need_app(T0 + 3 * MIN).unwrap());
        let st = m.snapshot(T0 + 10 * MIN);
        assert_eq!(st.pause_reason, Some(PauseReason::NeedApp));
        assert_eq!((st.pause_count, st.need_app_count), (1, 1));
        assert_eq!(st.remaining_ms, Some(4 * MIN));
        m.resume(T0 + 10 * MIN).unwrap();
        assert!(m.is_break_locked());
        assert!(m.need_app(T0 + 11 * MIN).unwrap());
        assert_eq!(m.snapshot(T0 + 11 * MIN).need_app_count, 2);
        assert_eq!(m.snapshot(T0 + 11 * MIN).pause_count, 2);
    }

    #[test]
    fn flowtime_break_is_a_fifth_with_one_minute_minimum() {
        let mut m = machine(FocusConfig::new(Technique::Flowtime));
        assert_eq!(m.snapshot(T0).remaining_ms, None);
        assert!(m.tick(T0 + 300 * MIN).is_empty(), "flowtime work is open-ended");
        let t = m.end_work(T0 + 50 * MIN).unwrap();
        assert_eq!((t.from, t.to), (Phase::Work, Phase::Break));
        assert_eq!(m.phase_duration_ms, Some(10 * MIN));
        let tr = m.tick(T0 + 60 * MIN);
        assert_eq!(tr[0].to, Phase::Work);
        assert_eq!(m.block, 2);
        m.end_work(T0 + 62 * MIN).unwrap();
        assert_eq!(m.phase_duration_ms, Some(MIN));
        let st = m.snapshot(T0 + 62 * MIN);
        assert_eq!(st.total_focus_ms, 52 * MIN);
        assert_eq!(st.total_break_ms, 10 * MIN);
    }

    #[test]
    fn timebox_ends_after_its_break() {
        let cfg = FocusConfig { work_mins: Some(20.0), break_mins: Some(5.0), ..FocusConfig::new(Technique::Timebox) };
        let mut m = machine(cfg);
        let tr = run(&mut m, T0, T0 + 30 * MIN);
        assert_eq!(tr.iter().map(|t| t.to).collect::<Vec<_>>(), vec![Phase::Break, Phase::Done]);
        assert_eq!(tr[1].at, T0 + 25 * MIN);
        assert_eq!(m.phase, Phase::Done);
        assert!(m.pause(T0 + 30 * MIN).is_err());
        let tot = m.totals(T0 + 30 * MIN);
        assert_eq!((tot.focus_ms, tot.break_ms), (20 * MIN, 5 * MIN));
    }

    #[test]
    fn sleep_gap_pauses_at_next_block_start() {
        let mut m = machine(FocusConfig::new(Technique::Pomodoro));
        run(&mut m, T0, T0 + 24 * MIN);
        // Mac sleeps at 24 min, wakes at 3 h: work→break and break→work are both overdue
        let wake = T0 + 180 * MIN;
        let tr = m.tick(wake);
        assert_eq!(tr.len(), 2);
        assert_eq!((tr[0].to, tr[0].at, tr[0].auto_paused), (Phase::Break, T0 + 25 * MIN, false));
        assert_eq!((tr[1].to, tr[1].at, tr[1].auto_paused), (Phase::Work, T0 + 30 * MIN, true));
        let st = m.snapshot(wake);
        assert!(st.paused);
        assert_eq!(st.pause_reason, Some(PauseReason::User));
        assert_eq!(st.phase_started_at, T0 + 30 * MIN);
        assert_eq!(st.elapsed_ms, 0);
        assert_eq!(st.remaining_ms, Some(25 * MIN));
        assert_eq!(st.total_focus_ms, 25 * MIN, "no focus credited while asleep");
        assert_eq!(st.total_break_ms, 5 * MIN);
        assert_eq!(tr[1].state, st);
        // resume picks up the full block
        m.resume(wake).unwrap();
        assert!(m.tick(wake + 24 * MIN).is_empty());
        let tr = m.tick(wake + 25 * MIN);
        assert_eq!(tr[0].at, wake + 25 * MIN);
        assert_eq!(m.snapshot(wake + 25 * MIN).total_focus_ms, 50 * MIN);
    }

    #[test]
    fn short_tick_delay_does_not_pause() {
        let mut m = machine(custom(1.0, 1.0));
        m.tick(T0 + MIN);
        let tr = m.tick(T0 + 2 * MIN + 2 * S);
        assert_eq!(tr.len(), 1);
        assert!(!tr[0].auto_paused);
        assert!(!m.is_paused());
        assert_eq!(m.snapshot(T0 + 2 * MIN + 2 * S).elapsed_ms, 2 * S);
    }

    #[test]
    fn stop_returns_totals_excluding_pauses() {
        let mut m = machine(custom(10.0, 2.0));
        m.pause(T0 + MIN).unwrap();
        m.resume(T0 + 4 * MIN).unwrap();
        let tot = m.stop(T0 + 6 * MIN);
        assert_eq!(tot, Totals { focus_ms: 3 * MIN, break_ms: 0, pauses: 1 });
        assert_eq!(m.phase, Phase::Done);
    }

    #[test]
    fn snapshot_survives_serde_round_trip() {
        let mut m = machine(custom(10.0, 2.0));
        m.tick(T0 + 10 * MIN);
        m.need_app(T0 + 11 * MIN).unwrap();
        let json = serde_json::to_string(&m).unwrap();
        let back: FocusMachine = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
        let now = T0 + 15 * MIN;
        assert_eq!(back.snapshot(now), m.snapshot(now));
        let st = serde_json::to_value(m.snapshot(now)).unwrap();
        for key in [
            "sessionId", "spaceId", "technique", "goal", "phase", "block", "phaseStartedAt", "phaseDurationMs",
            "elapsedMs", "remainingMs", "paused", "pauseReason", "pauseCount", "needAppCount", "totalFocusMs",
            "totalBreakMs", "checkInMins", "energy", "now",
        ] {
            assert!(st.get(key).is_some(), "missing {key}");
        }
        assert_eq!(st["pauseReason"], "needApp");
        assert_eq!(st["technique"], "custom");
        let tr = serde_json::to_value(m.clone().tick(T0)).unwrap();
        assert_eq!(tr, serde_json::json!([]));
    }

    #[test]
    fn energy_round_trips_from_config_to_state() {
        let cfg: FocusConfig =
            serde_json::from_value(serde_json::json!({ "technique": "flowtime", "energy": "low" })).unwrap();
        let m = FocusMachine::start("x".into(), &cfg, T0).unwrap();
        assert_eq!(m.energy, Energy::Low);
        assert_eq!(serde_json::to_value(m.snapshot(T0)).unwrap()["energy"], "low");
        let dflt: FocusConfig = serde_json::from_value(serde_json::json!({ "technique": "flowtime" })).unwrap();
        assert_eq!(FocusMachine::start("y".into(), &dflt, T0).unwrap().energy, Energy::Normal);
    }

    #[test]
    fn restores_persisted_machine_without_energy() {
        let m = machine(custom(10.0, 2.0));
        let mut json = serde_json::to_value(&m).unwrap();
        json.as_object_mut().unwrap().remove("energy");
        let back: FocusMachine = serde_json::from_value(json).unwrap();
        assert_eq!(back.energy, Energy::Normal);
        assert_eq!(back, m);
    }

    #[test]
    fn config_parses_from_ts_shape() {
        let cfg: FocusConfig = serde_json::from_value(serde_json::json!({
            "technique": "52-17", "goal": " ch 3 ", "spaceId": null, "checkInMins": 15
        }))
        .unwrap();
        let m = FocusMachine::start("x".into(), &cfg, T0).unwrap();
        assert_eq!(m.work_ms, Some(52 * MIN));
        assert_eq!(m.goal.as_deref(), Some("ch 3"));
        assert_eq!(m.check_in_mins, 15);
        let bad = FocusConfig { work_mins: Some(0.0), ..FocusConfig::new(Technique::Custom) };
        assert!(FocusMachine::start("x".into(), &bad, T0).is_err());
    }
}
