import type { Ability, InsightsActivity, ReviewRow, TopicLevel } from "../types";
import { difficultyFor, pCorrect } from "../practice/irt";

const DAY = 86_400_000;

export interface RetentionBucket {
  label: string;
  minDays: number;
  maxDays: number;
  n: number;
  recall: number;
}

const BUCKETS: [string, number, number][] = [
  ["< 1 day", 0, 1],
  ["1–3 days", 1, 3],
  ["3–7 days", 3, 7],
  ["1–2 weeks", 7, 14],
  ["2–4 weeks", 14, 30],
  ["> 1 month", 30, Infinity],
];

/** Each review after a card's first, with the gap since the previous review of that card. */
export function reviewGaps(reviews: ReviewRow[]): { row: ReviewRow; gapDays: number }[] {
  const last = new Map<string, number>();
  const out: { row: ReviewRow; gapDays: number }[] = [];
  for (const r of [...reviews].sort((a, b) => a.reviewedAt - b.reviewedAt)) {
    const prev = last.get(r.cardId);
    if (prev != null) out.push({ row: r, gapDays: (r.reviewedAt - prev) / DAY });
    last.set(r.cardId, r.reviewedAt);
  }
  return out;
}

/** Share of reviews recalled (anything but Again) by time since the last review. Empty buckets are left out. */
export function retentionCurve(reviews: ReviewRow[]): RetentionBucket[] {
  const gaps = reviewGaps(reviews);
  return BUCKETS.map(([label, minDays, maxDays]) => {
    const inB = gaps.filter((g) => g.gapDays >= minDays && g.gapDays < maxDays);
    const ok = inB.filter((g) => g.row.rating > 1).length;
    return { label, minDays, maxDays, n: inB.length, recall: inB.length ? ok / inB.length : 0 };
  }).filter((b) => b.n > 0);
}

export interface ForgetGroup {
  key: string;
  n: number;
  lapseRate: number;
}

/**
 * Groups (sources or spaces) ranked by how often cards are forgotten after at least a day.
 * Needs `minN` such reviews per group so one bad day doesn't make a headline.
 */
export function forgetFastest(reviews: ReviewRow[], keyOf: (r: ReviewRow) => string | null, minN = 5): ForgetGroup[] {
  const acc = new Map<string, { n: number; lapses: number }>();
  for (const { row, gapDays } of reviewGaps(reviews)) {
    if (gapDays < 1) continue;
    const k = keyOf(row);
    if (!k) continue;
    const e = acc.get(k) ?? { n: 0, lapses: 0 };
    e.n++;
    if (row.rating === 1) e.lapses++;
    acc.set(k, e);
  }
  return [...acc]
    .filter(([, e]) => e.n >= minN)
    .map(([key, e]) => ({ key, n: e.n, lapseRate: e.lapses / e.n }))
    .sort((a, b) => b.lapseRate - a.lapseRate || b.n - a.n);
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";
export const DAY_PARTS: DayPart[] = ["morning", "afternoon", "evening", "night"];

export function dayPart(ms: number): DayPart {
  const h = new Date(ms).getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

export interface DayPartStat {
  part: DayPart;
  answers: number;
  accuracy: number;
  focusMinutes: number;
}

/** Accuracy of reviews (after a day or more) and practice answers per part of the day, plus focus time. */
export function studyTimes(a: InsightsActivity): DayPartStat[] {
  const stats = new Map<DayPart, { answers: number; ok: number; focusMs: number }>(DAY_PARTS.map((p) => [p, { answers: 0, ok: 0, focusMs: 0 }]));
  for (const { row, gapDays } of reviewGaps(a.reviews)) {
    if (gapDays < 1) continue;
    const s = stats.get(dayPart(row.reviewedAt))!;
    s.answers++;
    if (row.rating > 1) s.ok++;
  }
  for (const t of a.attempts) {
    const s = stats.get(dayPart(t.createdAt))!;
    s.answers++;
    if (t.correct) s.ok++;
  }
  for (const f of a.focus) stats.get(dayPart(f.startedAt))!.focusMs += f.focusMs;
  return DAY_PARTS.map((part) => {
    const s = stats.get(part)!;
    return { part, answers: s.answers, accuracy: s.answers ? s.ok / s.answers : 0, focusMinutes: Math.round(s.focusMs / 60_000) };
  });
}

/**
 * The part of the day with clearly the best accuracy, or null while there's too little data
 * (each compared part needs `minAnswers`, and the lead must be at least 5 points).
 */
export function bestStudyTime(stats: DayPartStat[], minAnswers = 15): DayPartStat | null {
  const enough = stats.filter((s) => s.answers >= minAnswers).sort((a, b) => b.accuracy - a.accuracy);
  if (enough.length < 2) return null;
  return enough[0].accuracy - enough[1].accuracy >= 0.05 ? enough[0] : null;
}

/** Minutes after midnight when study usually ends; days that end before 4:00 count as the evening before. */
export function usualEnd(a: InsightsActivity, now: number, days = 21): number | null {
  const ends = new Map<string, number>();
  const shift = 4 * 3600_000;
  const times = [
    ...a.reviews.map((r) => r.reviewedAt),
    ...a.attempts.map((t) => t.createdAt),
    ...a.focus.map((f) => f.startedAt + f.focusMs),
  ].filter((t) => t >= now - days * DAY && t <= now);
  for (const t of times) {
    const d = new Date(t - shift);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    ends.set(key, Math.max(ends.get(key) ?? 0, t));
  }
  if (ends.size < 3) return null;
  const mins = [...ends.values()]
    .map((t) => {
      const d = new Date(t);
      const m = d.getHours() * 60 + d.getMinutes();
      return m < 240 ? m + 1440 : m;
    })
    .sort((x, y) => x - y);
  return mins[Math.floor(mins.length / 2)] % 1440;
}

/**
 * A short review in the last half hour before study usually ends helps memory consolidate during sleep.
 * Only suggested when study usually ends in the evening (from 19:00) and there are cards due.
 */
export function reviewBeforeSleep(end: number | null, dueCards: number): { at: number; cards: number } | null {
  if (end == null || dueCards === 0) return null;
  const evening = end >= 19 * 60 || end < 4 * 60;
  if (!evening) return null;
  return { at: (end - 30 + 1440) % 1440, cards: Math.min(dueCards, 20) };
}

export const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Focus minutes per local day for the last `days` days, oldest first. */
export function dailyMinutes(a: InsightsActivity, now: number, days = 14): { day: number; minutes: number }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const out = Array.from({ length: days }, (_, i) => ({ day: start.getTime() - (days - 1 - i) * DAY, minutes: 0 }));
  for (const f of a.focus) {
    const d = new Date(f.startedAt);
    d.setHours(0, 0, 0, 0);
    const slot = out.find((o) => Math.abs(o.day - d.getTime()) < DAY / 2);
    if (slot) slot.minutes += Math.round(f.focusMs / 60_000);
  }
  return out;
}

// ---- mastery and readiness ----

export interface TopicMastery {
  topicId: string;
  /** chance of answering an exam-level question on this topic, or null when nothing is known */
  p: number | null;
  /** how much evidence: answered practice items, or 3 for a placement result */
  evidence: number;
}

/** Exam questions sit between "medium" and "hard" on the practice scale. */
export const EXAM_DIFFICULTY = difficultyFor(3.5);
const LEVEL_P: Record<string, number> = { weak: 0.35, ok: 0.65, strong: 0.88 };

export function topicMastery(topicIds: string[], levels: Pick<TopicLevel, "topicId" | "level">[], abilities: Ability[]): TopicMastery[] {
  const lv = new Map(levels.map((l) => [l.topicId, l.level]));
  const ab = new Map(abilities.map((a) => [a.topicKey, a]));
  return topicIds.map((topicId) => {
    const a = ab.get(topicId);
    if (a && a.n >= 3) return { topicId, p: pCorrect(a.theta, EXAM_DIFFICULTY), evidence: a.n };
    const l = lv.get(topicId);
    if (l && l in LEVEL_P) return { topicId, p: LEVEL_P[l], evidence: 3 };
    return { topicId, p: null, evidence: 0 };
  });
}

export interface Readiness {
  /** expected share of exam questions answered correctly */
  expected: number;
  /** chance the score clears `passMark` */
  pass: number;
  known: number;
  total: number;
}

const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Chance of passing an exam of `items` questions spread evenly over the topics, with `passMark`
 * as the share needed. Unknown topics count as a coin flip with wide uncertainty, and a topic
 * with little evidence adds its own uncertainty, so the estimate stays modest until there's data.
 * Returns null when fewer than a third of the topics are known.
 */
export function readiness(m: TopicMastery[], passMark = 0.62, items = 46): Readiness | null {
  const known = m.filter((t) => t.p != null);
  if (!m.length || known.length * 3 < m.length) return null;
  let mean = 0;
  let varTopic = 0;
  for (const t of m) {
    const p = t.p ?? 0.5;
    mean += p;
    const sd = t.p == null ? 0.25 : 0.2 / Math.sqrt(1 + t.evidence / 3);
    varTopic += sd * sd;
  }
  mean /= m.length;
  varTopic /= m.length * m.length;
  const varItems = (mean * (1 - mean)) / items;
  const pass = normalCdf((mean - passMark) / Math.sqrt(varItems + varTopic));
  return { expected: mean, pass, known: known.length, total: m.length };
}

/** Depth of each topic in its prerequisite graph (0 = no prerequisites); cycles are cut. */
export function prereqDepth(topics: { id: string; prereqs?: string[] }[]): Map<string, number> {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const pre = (byId.get(id)?.prereqs ?? []).filter((p) => byId.has(p));
    const d = pre.length ? 1 + Math.max(...pre.map((p) => visit(p, seen))) : 0;
    depth.set(id, d);
    return d;
  };
  for (const t of topics) visit(t.id, new Set());
  return depth;
}
