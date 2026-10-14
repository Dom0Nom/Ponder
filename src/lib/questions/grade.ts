import { numbersMatch, parseNumber } from "../practice/grade";
import type { Credit, Question, Region, Response } from "./types";

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, "");

export function fillMatches(accepted: string[], text: string, numeric?: boolean): boolean {
  if (!text.trim()) return false;
  const given = parseNumber(text);
  for (const a of accepted) {
    if (norm(a) === norm(text)) return true;
    const n = parseNumber(a);
    if ((numeric || n != null) && n != null && given != null && numbersMatch(given, n)) return true;
  }
  return false;
}

export function inRegion(region: Region, r: Extract<Response, { kind: "hotspot" }>): boolean {
  if (region.shape === "cell") return r.row === region.row && r.col === region.col;
  if (r.x == null || r.y == null) return false;
  if (region.shape === "circle") return Math.hypot(r.x - region.x, r.y - region.y) <= region.r;
  return r.x >= region.x && r.x <= region.x + region.w && r.y >= region.y && r.y <= region.y + region.h;
}

const result = (credit: number, answered: boolean): Credit => {
  const c = Math.max(0, Math.min(1, credit));
  return { credit: c, correct: c >= 0.999, answered };
};

/**
 * One grader for every kind. `multi` scores (right picks - wrong picks) / right answers, floored at 0;
 * `drag` and `dropdown` score the share of items or blanks that are right.
 */
export function gradeQuestion(q: Question, r: Response | null | undefined): Credit {
  if (!r || r.kind !== q.kind) return result(0, false);
  switch (q.kind) {
    case "mc":
      return r.kind === "mc" ? result(r.choice === q.answer ? 1 : 0, r.choice >= 0) : result(0, false);
    case "multi": {
      if (r.kind !== "multi") return result(0, false);
      const want = new Set(q.answers);
      const picked = new Set(r.choices);
      let right = 0;
      let wrong = 0;
      for (const c of picked) want.has(c) ? right++ : wrong++;
      return result(want.size ? (right - wrong) / want.size : 0, picked.size > 0);
    }
    case "fill":
      return r.kind === "fill" ? result(fillMatches(q.accepted, r.text, q.numeric) ? 1 : 0, !!r.text.trim()) : result(0, false);
    case "dropdown": {
      if (r.kind !== "dropdown") return result(0, false);
      const right = q.blanks.filter((b, i) => r.picks[i] === b.answer).length;
      return result(q.blanks.length ? right / q.blanks.length : 0, r.picks.some((p) => p != null));
    }
    case "drag": {
      if (r.kind !== "drag") return result(0, false);
      if (q.mode === "order") {
        const want = q.correctOrder ?? [];
        const got = r.order ?? [];
        const right = want.filter((v, i) => got[i] === v).length;
        return result(want.length ? right / want.length : 0, got.length > 0);
      }
      const want = q.correctCategory ?? [];
      const got = r.placed ?? [];
      const right = want.filter((v, i) => got[i] === v).length;
      return result(want.length ? right / want.length : 0, got.some((g) => g != null && g >= 0));
    }
    case "hotspot":
      return r.kind === "hotspot" ? result(inRegion(q.region, r) ? 1 : 0, r.x != null || r.row != null) : result(0, false);
  }
}

export const questionPoints = (q: Question) => q.points ?? 1;

/** Points earned, rounded to quarter points. */
export function pointsFor(q: Question, r: Response | null | undefined): number {
  return Math.round(gradeQuestion(q, r).credit * questionPoints(q) * 4) / 4;
}

/** The right answer in words, for review screens and mistake notes. */
export function answerText(q: Question): string {
  switch (q.kind) {
    case "mc":
      return q.options[q.answer] ?? "";
    case "multi":
      return q.answers.map((i) => q.options[i]).join("; ");
    case "fill":
      return q.accepted[0] ?? "";
    case "dropdown":
      return q.blanks.map((b, i) => `${i + 1}: ${b.options[b.answer]}`).join("; ");
    case "drag":
      return q.mode === "order"
        ? (q.correctOrder ?? []).map((i) => q.items[i]).join(" → ")
        : q.items.map((it, i) => `${it} → ${q.categories?.[q.correctCategory?.[i] ?? 0] ?? ""}`).join("; ");
    case "hotspot":
      return q.region.shape === "cell" ? `${q.region.row + 1}/${q.region.col + 1}` : `(${q.region.x}, ${q.region.y})`;
  }
}

export function responseText(q: Question, r: Response | null | undefined): string {
  if (!r || r.kind !== q.kind) return "";
  if (r.kind === "mc" && q.kind === "mc") return q.options[r.choice] ?? "";
  if (r.kind === "multi" && q.kind === "multi") return r.choices.map((i) => q.options[i]).join("; ");
  if (r.kind === "fill") return r.text;
  if (r.kind === "dropdown" && q.kind === "dropdown") return r.picks.map((p, i) => (p == null ? "–" : (q.blanks[i]?.options[p] ?? ""))).join("; ");
  if (r.kind === "drag" && q.kind === "drag") {
    return q.mode === "order" ? (r.order ?? []).map((i) => q.items[i]).join(" → ") : q.items.map((it, i) => `${it} → ${q.categories?.[r.placed?.[i] ?? -1] ?? "–"}`).join("; ");
  }
  if (r.kind === "hotspot") return r.row != null ? `${r.row + 1}/${(r.col ?? 0) + 1}` : r.x != null ? `(${r.x.toFixed(1)}, ${r.y?.toFixed(1)})` : "";
  return "";
}
