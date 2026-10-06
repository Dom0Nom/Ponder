import type { BuddyEventKind, FocusState } from "../types";

export interface BuddyEvent {
  kind: BuddyEventKind;
  sessionId: string;
  spaceId: string | null;
  block: number;
  state: FocusState | null;
  /** the snapshot before the transition, e.g. totals for the session summary */
  previous: FocusState | null;
}

export interface BuddyState {
  initialized: boolean;
  last: FocusState | null;
  /** check-ins already fired in the current block */
  checkIns: number;
  recallDone: boolean;
  /** hyperfocus nudges already fired in the current block */
  hyperfocus: number;
}

export interface BuddyOptions {
  /** minutes of continuous work per hyperfocus nudge; 0/undefined disables it */
  hyperfocusMins?: number;
}

export const initialBuddyState: BuddyState = {
  initialized: false,
  last: null,
  checkIns: 0,
  recallDone: false,
  hyperfocus: 0,
};

const DISABLED = Number.MAX_SAFE_INTEGER;

function hyperfocusDue(s: FocusState, mins: number | undefined): number {
  if (!mins || mins <= 0) return DISABLED;
  if (s.technique !== "flowtime" && s.technique !== "timebox") return DISABLED;
  if (s.phase !== "work") return DISABLED;
  return Math.floor(s.elapsedMs / (mins * 60_000));
}

export const RECALL_LEAD_MS = 3 * 60_000;
const MIN_BLOCK_FOR_RECALL_MS = 8 * 60_000;
/** no check-in this close to the break; the T-3 recall covers it */
const CHECKIN_QUIET_MS = 4 * 60_000;

const isBreak = (s: FocusState | null) => !!s && (s.phase === "break" || s.phase === "longBreak");
const isWork = (s: FocusState | null) => !!s && s.phase === "work";

function checkInsDue(s: FocusState): number {
  if (!s.checkInMins || s.checkInMins <= 0) return 0;
  return Math.floor(s.elapsedMs / (s.checkInMins * 60_000));
}

function recallDue(s: FocusState): boolean {
  return (
    isWork(s) &&
    !s.paused &&
    s.phaseDurationMs != null &&
    s.phaseDurationMs >= MIN_BLOCK_FOR_RECALL_MS &&
    s.remainingMs != null &&
    s.remainingMs > 0 &&
    s.remainingMs <= RECALL_LEAD_MS
  );
}

/**
 * Derives study-buddy events from consecutive timer snapshots. Pure: the caller feeds every
 * tick (or null when no session runs) and posts the returned events. The first snapshot after a
 * UI reload only initializes state, so nothing is re-announced.
 */
export function stepBuddy(
  state: BuddyState,
  next: FocusState | null,
  opts: BuddyOptions = {},
): { state: BuddyState; events: BuddyEvent[] } {
  if (!state.initialized) {
    return {
      state: {
        initialized: true,
        last: next,
        checkIns: next && isWork(next) ? checkInsDue(next) : 0,
        recallDone: !!next && isWork(next) && next.remainingMs != null && next.remainingMs <= RECALL_LEAD_MS,
        hyperfocus: next ? hyperfocusDue(next, opts.hyperfocusMins) : 0,
      },
      events: [],
    };
  }

  const prev = state.last;
  const events: BuddyEvent[] = [];
  const ev = (kind: BuddyEventKind, s: FocusState | null, ref: FocusState): BuddyEvent => ({
    kind,
    sessionId: ref.sessionId,
    spaceId: ref.spaceId,
    block: ref.block,
    state: s,
    previous: prev,
  });
  let checkIns = state.checkIns;
  let recallDone = state.recallDone;
  let hyperfocus = state.hyperfocus;

  const sameSession = !!prev && !!next && prev.sessionId === next.sessionId;

  if (prev && (!next || !sameSession || next.phase === "done")) {
    events.push(ev("session-summary", next && sameSession ? next : null, prev));
  }

  if (next && next.phase !== "done") {
    if (!sameSession) {
      events.push(ev("session-start", next, next));
      checkIns = 0;
      recallDone = false;
      hyperfocus = 0;
    } else if (prev && prev.phase !== next.phase) {
      if (isWork(prev) && isBreak(next)) events.push(ev("block-quiz", next, prev));
      if (isBreak(prev) && isWork(next)) events.push(ev("post-break", next, next));
      if (isWork(next)) {
        checkIns = 0;
        recallDone = false;
        hyperfocus = 0;
      }
    } else if (prev && prev.block !== next.block && isWork(next)) {
      checkIns = 0;
      recallDone = false;
      hyperfocus = 0;
    }

    if (isWork(next) && !next.paused) {
      const due = hyperfocusDue(next, opts.hyperfocusMins);
      if (due === DISABLED) hyperfocus = DISABLED;
      else if (due > hyperfocus) {
        if (sameSession) events.push(ev("hyperfocus", next, next));
        hyperfocus = due;
      }
    }

    if (isWork(next) && !next.paused) {
      if (recallDue(next) && !recallDone) {
        events.push(ev("recall", next, next));
        recallDone = true;
      } else {
        const due = checkInsDue(next);
        const quiet = next.remainingMs != null && next.remainingMs < CHECKIN_QUIET_MS;
        if (due > checkIns) {
          if (!quiet && sameSession) events.push(ev("check-in", next, next));
          checkIns = due;
        }
      }
    }
  }

  return {
    state: { initialized: true, last: next && next.phase !== "done" ? next : null, checkIns, recallDone, hyperfocus },
    events,
  };
}
