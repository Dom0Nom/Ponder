use crate::focus::machine::{FocusState, Phase};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Tracker {
    pub playing: bool,
    /// session whose playlist has been started
    pub started: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// first work block of a session: play the playlist from the start
    Start,
    Resume,
    Pause,
}

pub fn wants_music(state: Option<&FocusState>) -> bool {
    state.is_some_and(|s| s.phase == Phase::Work && !s.paused)
}

/// Tracker for a session that already exists at launch: nothing is started or stopped.
pub fn initial(state: Option<&FocusState>) -> Tracker {
    Tracker { playing: wants_music(state), started: state.map(|s| s.session_id.clone()) }
}

/// Acts only when the desired state differs from the previous one.
pub fn next(prev: &Tracker, state: Option<&FocusState>) -> (Tracker, Option<Action>) {
    let want = wants_music(state);
    let started = state.map(|s| s.session_id.clone());
    let action = match (prev.playing, want) {
        (false, true) if prev.started == started => Some(Action::Resume),
        (false, true) => Some(Action::Start),
        (true, false) => Some(Action::Pause),
        _ => None,
    };
    (Tracker { playing: want, started }, action)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::focus::machine::{PauseReason, Technique};

    fn st(id: &str, phase: Phase, paused: bool) -> FocusState {
        FocusState {
            session_id: id.into(),
            space_id: None,
            technique: Technique::Custom,
            goal: None,
            phase,
            block: 1,
            phase_started_at: 0,
            phase_duration_ms: None,
            elapsed_ms: 0,
            remaining_ms: None,
            paused,
            pause_reason: paused.then_some(PauseReason::User),
            pause_count: 0,
            need_app_count: 0,
            total_focus_ms: 0,
            total_break_ms: 0,
            check_in_mins: 0,
            now: 0,
        }
    }

    fn run(t: &mut Tracker, s: Option<&FocusState>) -> Option<Action> {
        let (n, a) = next(t, s);
        *t = n;
        a
    }

    #[test]
    fn full_session_flow() {
        let mut t = Tracker::default();
        let work = st("a", Phase::Work, false);
        assert_eq!(run(&mut t, Some(&work)), Some(Action::Start));
        assert_eq!(run(&mut t, Some(&work)), None, "ticks do nothing");
        assert_eq!(run(&mut t, Some(&st("a", Phase::Work, true))), Some(Action::Pause));
        assert_eq!(run(&mut t, Some(&work)), Some(Action::Resume));
        assert_eq!(run(&mut t, Some(&st("a", Phase::Break, false))), Some(Action::Pause));
        assert_eq!(run(&mut t, Some(&st("a", Phase::Break, true))), None);
        assert_eq!(run(&mut t, Some(&work)), Some(Action::Resume));
        assert_eq!(run(&mut t, Some(&st("a", Phase::LongBreak, false))), Some(Action::Pause));
        assert_eq!(run(&mut t, Some(&work)), Some(Action::Resume));
        assert_eq!(run(&mut t, None), Some(Action::Pause));
        assert_eq!(run(&mut t, None), None);
        assert_eq!(run(&mut t, Some(&st("b", Phase::Work, false))), Some(Action::Start));
    }

    #[test]
    fn restored_session_does_not_act() {
        let work = st("a", Phase::Work, false);
        let mut t = initial(Some(&work));
        assert_eq!(run(&mut t, Some(&work)), None);
        assert_eq!(run(&mut t, Some(&st("a", Phase::Break, false))), Some(Action::Pause));

        let mut t = initial(Some(&st("a", Phase::Break, false)));
        assert_eq!(run(&mut t, Some(&st("a", Phase::Break, false))), None);
        assert_eq!(run(&mut t, Some(&work)), Some(Action::Resume));

        let mut t = initial(None);
        assert_eq!(run(&mut t, None), None);
    }
}
