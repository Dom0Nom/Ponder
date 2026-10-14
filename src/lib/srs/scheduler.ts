import { createEmptyCard, fsrs, generatorParameters, Rating, type Card as FsrsCard, type Grade } from "ts-fsrs";
import type { Card } from "../types";
import { formatUnit } from "../i18n/format";
import { s } from "../strings";

export const scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 3650, enable_fuzz: true }));

export const GRADES: { rating: Grade; readonly label: string; key: string }[] = [
  { rating: Rating.Again, get label() { return s.review.grades.again; }, key: "1" },
  { rating: Rating.Hard, get label() { return s.review.grades.hard; }, key: "2" },
  { rating: Rating.Good, get label() { return s.review.grades.good; }, key: "3" },
  { rating: Rating.Easy, get label() { return s.review.grades.easy; }, key: "4" },
];

/** Stored JSON → ts-fsrs card (dates come back as numbers). */
export function toFsrs(card: Pick<Card, "fsrs" | "due">, now = new Date()): FsrsCard {
  const f = card.fsrs as (Partial<Record<keyof FsrsCard, unknown>> & { due?: number; last_review?: number | null }) | null;
  if (!f || f.stability == null) return createEmptyCard(now);
  return {
    due: new Date(Number(f.due ?? card.due)),
    stability: Number(f.stability),
    difficulty: Number(f.difficulty),
    elapsed_days: Number(f.elapsed_days ?? 0),
    scheduled_days: Number(f.scheduled_days ?? 0),
    learning_steps: Number(f.learning_steps ?? 0),
    reps: Number(f.reps ?? 0),
    lapses: Number(f.lapses ?? 0),
    state: Number(f.state ?? 0),
    last_review: f.last_review ? new Date(Number(f.last_review)) : undefined,
  } as FsrsCard;
}

export function fromFsrs(c: FsrsCard): Record<string, unknown> {
  return { ...c, due: c.due.getTime(), last_review: c.last_review ? c.last_review.getTime() : null };
}

export function schedule(card: Pick<Card, "fsrs" | "due">, rating: Grade, now = new Date()) {
  const r = scheduler.next(toFsrs(card, now), now, rating);
  return {
    fsrs: fromFsrs(r.card),
    due: r.card.due.getTime(),
    state: r.card.state as number,
    log: { ...r.log, due: r.log.due.getTime(), review: r.log.review.getTime() },
  };
}

/** "1m", "10m", "3d", "2mo" — what each button would schedule. */
export function previewIntervals(card: Pick<Card, "fsrs" | "due">, now = new Date()): Record<number, string> {
  const preview = scheduler.repeat(toFsrs(card, now), now);
  const out: Record<number, string> = {};
  for (const g of GRADES) out[g.rating] = formatInterval(preview[g.rating].card.due.getTime() - now.getTime());
  return out;
}

export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return formatUnit(min, "minute", "narrow");
  const h = Math.round(min / 60);
  if (h < 24) return formatUnit(h, "hour", "narrow");
  const d = Math.round(h / 24);
  if (d < 31) return formatUnit(d, "day", "narrow");
  const mo = Math.round(d / 30);
  if (mo < 12) return formatUnit(mo, "month", "short");
  return formatUnit(d / 365, "year", "short");
}
