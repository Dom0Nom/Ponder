import { describe, expect, it } from "vitest";
import { initialBuddyState, stepBuddy, type BuddyOptions, type BuddyState } from "./engine";
import type { FocusState } from "../types";

const MIN = 60_000;

function st(p: Partial<FocusState>): FocusState {
  return {
    sessionId: "s1",
    spaceId: "sp",
    technique: "pomodoro",
    goal: null,
    phase: "work",
    block: 1,
    phaseStartedAt: 0,
    phaseDurationMs: 25 * MIN,
    elapsedMs: 0,
    remainingMs: 25 * MIN,
    paused: false,
    pauseReason: null,
    pauseCount: 0,
    needAppCount: 0,
    totalFocusMs: 0,
    totalBreakMs: 0,
    checkInMins: 10,
    now: 0,
    ...p,
  };
}

function run(
  seq: (FocusState | null)[],
  start: BuddyState = { ...initialBuddyState, initialized: true },
  opts: BuddyOptions = {},
) {
  let state = start;
  const kinds: string[] = [];
  for (const s of seq) {
    const r = stepBuddy(state, s, opts);
    state = r.state;
    kinds.push(...r.events.map((e) => e.kind));
  }
  return { kinds, state };
}

const at = (elapsedMin: number, extra: Partial<FocusState> = {}) =>
  st({ elapsedMs: elapsedMin * MIN, remainingMs: (25 - elapsedMin) * MIN, ...extra });

describe("study buddy engine", () => {
  it("announces start, check-ins, recall, quiz, post-break and summary in order", () => {
    const { kinds } = run([
      null,
      at(0),
      at(5),
      at(10),
      at(10.02),
      at(20),
      at(22),
      at(23),
      st({ phase: "break", phaseDurationMs: 5 * MIN, elapsedMs: 0, remainingMs: 5 * MIN }),
      st({ phase: "break", phaseDurationMs: 5 * MIN, elapsedMs: 2 * MIN, remainingMs: 3 * MIN }),
      st({ phase: "work", block: 2, elapsedMs: 0, remainingMs: 25 * MIN }),
      null,
    ]);
    expect(kinds).toEqual([
      "session-start",
      "check-in",
      "check-in",
      "recall",
      "block-quiz",
      "post-break",
      "session-summary",
    ]);
  });

  it("does not re-announce anything right after a UI reload", () => {
    const { kinds } = run([at(14), at(14.1), at(15)], initialBuddyState);
    expect(kinds).toEqual([]);
  });

  it("re-arms check-ins and recall for each block", () => {
    const { kinds } = run([
      at(0),
      at(23),
      st({ phase: "break", phaseDurationMs: 5 * MIN, remainingMs: 5 * MIN }),
      st({ phase: "work", block: 2, elapsedMs: 10 * MIN, remainingMs: 15 * MIN }),
      st({ phase: "work", block: 2, elapsedMs: 23 * MIN, remainingMs: 2 * MIN }),
    ]);
    expect(kinds).toEqual(["session-start", "recall", "block-quiz", "post-break", "check-in", "recall"]);
  });

  it("stays quiet while paused and skips check-ins in the last minutes", () => {
    const { kinds } = run([at(0), at(10, { paused: true, pauseReason: "user" }), at(21.5)]);
    // the 10-minute check-in never fired while paused; at 21.5 min we're inside the quiet window
    expect(kinds).toEqual(["session-start"]);
  });

  it("skips recall for short blocks and handles flowtime", () => {
    const short = run([st({ phaseDurationMs: 5 * MIN, remainingMs: 5 * MIN }), st({ phaseDurationMs: 5 * MIN, elapsedMs: 3 * MIN, remainingMs: 2 * MIN })]);
    expect(short.kinds).toEqual(["session-start"]);
    const flow = run([
      st({ technique: "flowtime", phaseDurationMs: null, remainingMs: null }),
      st({ technique: "flowtime", phaseDurationMs: null, remainingMs: null, elapsedMs: 31 * MIN }),
    ]);
    expect(flow.kinds).toEqual(["session-start", "check-in"]);
  });

  describe("hyperfocus guard", () => {
    const hf = { hyperfocusMins: 90 };
    const flow = (min: number, extra: Partial<FocusState> = {}) =>
      st({
        technique: "flowtime",
        phaseDurationMs: null,
        remainingMs: null,
        checkInMins: 0,
        elapsedMs: min * MIN,
        ...extra,
      });
    const only = (kinds: string[]) => kinds.filter((k) => k === "hyperfocus");

    it("fires once when flowtime crosses the threshold", () => {
      const { kinds } = run([flow(0), flow(30), flow(89), flow(90), flow(91), flow(120)], undefined, hf);
      expect(only(kinds)).toEqual(["hyperfocus"]);
    });

    it("repeats every further interval within the same block", () => {
      const { kinds } = run([flow(0), flow(90), flow(135), flow(180), flow(181), flow(270)], undefined, hf);
      expect(only(kinds)).toHaveLength(3);
    });

    it("fires for timebox sessions that run long enough", () => {
      const box = (min: number) =>
        st({ technique: "timebox", phaseDurationMs: 120 * MIN, remainingMs: (120 - min) * MIN, elapsedMs: min * MIN, checkInMins: 0 });
      const { kinds } = run([box(0), box(60), box(90)], undefined, hf);
      expect(only(kinds)).toEqual(["hyperfocus"]);
    });

    it("never fires for pomodoro or other techniques", () => {
      const pomo = (min: number) => st({ elapsedMs: min * MIN, remainingMs: 25 * MIN, phaseDurationMs: 200 * MIN, checkInMins: 0 });
      const { kinds } = run([pomo(0), pomo(95), pomo(190)], undefined, hf);
      expect(only(kinds)).toEqual([]);
    });

    it("stays quiet while paused and fires after resuming past the threshold", () => {
      const paused = { paused: true, pauseReason: "user" as const };
      const a = run([flow(0), flow(80, paused), flow(80, paused)], undefined, hf);
      expect(only(a.kinds)).toEqual([]);
      const b = run([flow(0), flow(89), flow(90, paused), flow(91)], undefined, hf);
      expect(only(b.kinds)).toEqual(["hyperfocus"]);
    });

    it("does not re-fire after a UI reload", () => {
      const { kinds, state } = run([flow(95), flow(96), flow(120)], initialBuddyState, hf);
      expect(only(kinds)).toEqual([]);
      const next = stepBuddy(state, flow(181), hf);
      expect(next.events.map((e) => e.kind)).toEqual(["hyperfocus"]);
    });

    it("does nothing when disabled and does not fire late when enabled mid-block", () => {
      const off = run([flow(0), flow(95), flow(200)], undefined, { hyperfocusMins: 0 });
      expect(only(off.kinds)).toEqual([]);
      const none = run([flow(0), flow(95), flow(200)]);
      expect(only(none.kinds)).toEqual([]);
      const late = stepBuddy(off.state, flow(210), hf);
      expect(late.events).toEqual([]);
    });

    it("honours custom minutes", () => {
      const { kinds } = run([flow(0), flow(44), flow(45), flow(60), flow(90)], undefined, { hyperfocusMins: 45 });
      expect(only(kinds)).toEqual(["hyperfocus", "hyperfocus"]);
    });

    it("re-arms in the next block after a break", () => {
      const brk = flow(0, { phase: "break", phaseDurationMs: 18 * MIN, remainingMs: 18 * MIN });
      const { kinds } = run([flow(0), flow(90), brk, flow(10, { block: 2 }), flow(90, { block: 2 })], undefined, hf);
      expect(only(kinds)).toHaveLength(2);
    });

    it("carries the nudge on a hyperfocus event with the current state", () => {
      let state: BuddyState = { ...initialBuddyState, initialized: true };
      state = stepBuddy(state, flow(10), hf).state;
      const r = stepBuddy(state, flow(90), hf);
      expect(r.events).toHaveLength(1);
      expect(r.events[0]).toMatchObject({ kind: "hyperfocus", sessionId: "s1", block: 1 });
      expect(r.events[0].state?.elapsedMs).toBe(90 * MIN);
    });
  });

  it("emits a summary when a new session replaces an old one", () => {
    const { kinds } = run([at(3), st({ sessionId: "s2" })]);
    expect(kinds).toEqual(["session-start", "session-summary", "session-start"]);
  });
});
