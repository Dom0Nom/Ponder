import { s } from "../../lib/strings";
import type { FocusState } from "../../lib/types";
import { formatDuration } from "../../lib/utils";

const HOUR = 3_600_000;

/** Remaining time for timed phases, elapsed time for open-ended flowtime work. */
export function clockMs(st: FocusState): number {
  return st.remainingMs ?? st.elapsedMs;
}

export function clockText(st: FocusState): string {
  const ms = st.remainingMs != null ? Math.ceil(st.remainingMs / 1000) * 1000 : st.elapsedMs;
  return formatDuration(ms);
}

export function clockLabel(st: FocusState): string {
  return st.remainingMs != null ? s.focus.timeLeft(clockText(st)) : s.focus.timeElapsed(clockText(st));
}

export function phaseLabel(st: FocusState): string {
  if (st.paused && st.phase === "work") return s.focus.paused;
  if (st.phase === "longBreak") return s.focus.longBreak;
  if (st.phase === "break") return s.focus.break;
  return s.focus.work;
}

/** Share of the dial that is filled: remaining fraction, or elapsed share of an hour when open-ended. */
export function timeFraction(st: FocusState): number {
  if (st.phaseDurationMs && st.remainingMs != null) {
    return Math.min(1, Math.max(0, st.remainingMs / st.phaseDurationMs));
  }
  return (st.elapsedMs % HOUR) / HOUR;
}

/** Accent during work, easing toward warm amber in the last 20% of a block; calm green on breaks. */
export function timeColor(st: FocusState): string {
  if (st.paused) return "var(--text-faint)";
  if (st.phase === "break" || st.phase === "longBreak") return "var(--timer-break)";
  if (st.remainingMs == null) return "var(--accent)";
  const warm = Math.min(1, Math.max(0, (0.2 - timeFraction(st)) / 0.2));
  if (warm === 0) return "var(--accent)";
  return `color-mix(in oklab, var(--timer-warm) ${Math.round(warm * 85)}%, var(--accent))`;
}
