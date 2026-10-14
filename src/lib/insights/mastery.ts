import type { MasteryRow, TopicRef } from "../types";

const DAY = 86_400_000;
export const RETEST_AFTER_MS = 3 * DAY;
export const RETEST_QUESTIONS = 3;
export const RETEST_PASS = 2;

export type MasteryStatus = "new" | "learning" | "waiting" | "retest" | "mastered";

/** Learned (practice level reached ok/strong): starts the 3-day clock. A topic already waiting or mastered is kept. */
export function markLearned(row: MasteryRow | null, topicKey: string, now: number): MasteryRow {
  if (row && row.state !== "learning") return row;
  return { topicKey, state: "retest", learnedAt: now, retestDueAt: now + RETEST_AFTER_MS, passedAt: null };
}

/** A retest result. Before the due time it counts for nothing. A fail sends the topic back to learning. */
export function applyRetest(row: MasteryRow, passed: boolean, now: number): MasteryRow {
  const due = row.state === "mastered" || (row.state === "retest" && row.retestDueAt != null && now >= row.retestDueAt);
  if (!due) return row;
  if (passed) return { ...row, state: "mastered", passedAt: now, retestDueAt: null };
  return { ...row, state: "learning", learnedAt: now, retestDueAt: null, passedAt: null };
}

export function statusOf(row: MasteryRow | null | undefined, now: number): MasteryStatus {
  if (!row) return "new";
  if (row.state === "mastered") return "mastered";
  if (row.state === "learning") return "learning";
  return row.retestDueAt != null && now >= row.retestDueAt ? "retest" : "waiting";
}

export const retestPassed = (correct: number, total: number) => total >= RETEST_QUESTIONS && correct >= RETEST_PASS;

export interface MapNode {
  topicKey: string;
  title: string;
  status: MasteryStatus;
  /** prerequisite topics not mastered yet, for a topic that hasn't been started */
  waitsFor: string[];
}

export function masteryMap(topics: TopicRef[], rows: MasteryRow[], practised: Set<string>, now: number): MapNode[] {
  const byKey = new Map(rows.map((r) => [r.topicKey, r]));
  const title = new Map(topics.map((t) => [t.id, t.title]));
  return topics.map((t) => {
    const status = statusOf(byKey.get(t.id), now);
    const waitsFor =
      status === "new" && !practised.has(t.id)
        ? (t.prereqs ?? []).filter((p) => title.has(p) && statusOf(byKey.get(p), now) !== "mastered").map((p) => title.get(p)!)
        : [];
    return { topicKey: t.id, title: t.title, status, waitsFor };
  });
}

export const retestsDue = (rows: MasteryRow[], now: number) => rows.filter((r) => statusOf(r, now) === "retest");
export const masteredCount = (rows: MasteryRow[]) => rows.filter((r) => r.state === "mastered").length;
