import type { QuestionKind } from "../questions/types";
import type { TopicRef } from "../types";

export type ExamLength = "short" | "full";

export type FormulaSheetId = "math" | "science";

/** A stretch of a section with its own calculator rule. `questions` omitted = the rest of the section. */
export interface SectionPart {
  questions?: number;
  calculator: boolean;
}

export interface ResolvedPart {
  from: number;
  to: number;
  calculator: boolean;
  minutes: number;
}

export interface ExamSection {
  id: string;
  title: string;
  /** curriculum group whose topics the questions cover */
  group: string;
  minutes: Record<ExamLength, number>;
  questions: Record<ExamLength, number>;
  calculator: boolean;
  /** calculator rule per stretch of questions; overrides `calculator` */
  parts?: SectionPart[];
  /** reference sheet offered during the section */
  formulaSheet?: FormulaSheetId;
  /** extended response: minutes inside the section's time */
  essayMinutes?: Record<ExamLength, number>;
  /** question kinds this section uses besides multiple choice; unset = multiple choice only */
  kinds?: QuestionKind[];
}

export interface ExamTier {
  id: string;
  min: number;
}

export interface ExamFormat {
  id: string;
  title: string;
  curriculumId: string;
  /** share of points needed to pass (estimate where the real cut is a scaled score) */
  passMark: number;
  /** scaled score range and passing score, when the exam reports one */
  scale?: { min: number; pass: number; max: number };
  /** named levels by lowest scaled score, ascending */
  tiers?: ExamTier[];
  /** the exam's official practice test, named in the estimate note */
  officialPractice?: string;
  sections: ExamSection[];
}

/**
 * GED: times and question counts follow the published test format (ged.com, 2026). Questions are
 * multiple choice; sections list the other kinds the real test uses (drag-and-drop, hot spots, fill-ins, drop-downs).
 */
export const GED: ExamFormat = {
  id: "ged",
  title: "GED",
  curriculumId: "ged",
  passMark: 0.62,
  scale: { min: 100, pass: 145, max: 200 },
  tiers: [
    { id: "pass", min: 145 },
    { id: "collegeReady", min: 165 },
    { id: "collegeReadyCredit", min: 175 },
  ],
  officialPractice: "GED Ready",
  sections: [
    {
      id: "math",
      title: "Mathematical Reasoning",
      group: "Math",
      minutes: { short: 30, full: 115 },
      questions: { short: 12, full: 46 },
      calculator: true,
      parts: [{ questions: 5, calculator: false }, { calculator: true }],
      formulaSheet: "math",
      kinds: ["mc", "fill", "multi", "drag", "hotspot"],
    },
    {
      id: "rla",
      title: "Reasoning Through Language Arts",
      group: "Reasoning Through Language Arts",
      minutes: { short: 50, full: 150 },
      questions: { short: 10, full: 46 },
      calculator: false,
      essayMinutes: { short: 25, full: 45 },
      kinds: ["mc", "dropdown", "drag", "multi"],
    },
    { id: "science", title: "Science", group: "Science", minutes: { short: 25, full: 90 }, questions: { short: 10, full: 34 }, calculator: true, formulaSheet: "science", kinds: ["mc", "fill", "multi", "drag", "hotspot", "dropdown"] },
    { id: "social", title: "Social Studies", group: "Social Studies", minutes: { short: 20, full: 70 }, questions: { short: 10, full: 35 }, calculator: true, kinds: ["mc", "multi", "drag", "dropdown", "hotspot"] },
  ],
};

/**
 * Digital SAT: two modules per section (times from satsuite.collegeboard.org, 2026). The real test is
 * adaptive between modules; here both modules are mid difficulty. "Pass" is the College Board benchmark.
 */
export const SAT: ExamFormat = {
  id: "sat",
  title: "SAT",
  curriculumId: "sat",
  passMark: 0.5,
  scale: { min: 200, pass: 500, max: 800 },
  sections: [
    { id: "rw", title: "Reading and Writing", group: "Reading and Writing", minutes: { short: 32, full: 64 }, questions: { short: 27, full: 54 }, calculator: false },
    { id: "math", title: "Math", group: "Math", minutes: { short: 35, full: 70 }, questions: { short: 22, full: 44 }, calculator: true },
  ],
};

export const EXAMS: ExamFormat[] = [GED, SAT];

export const examById = (id: string) => EXAMS.find((e) => e.id === id) ?? null;

export const examFor = (curriculumId: string | undefined) => EXAMS.find((e) => e.curriculumId === curriculumId) ?? null;

/** Topics a section's multiple-choice questions cover (the essay topic is handled separately). */
export const sectionTopics = (section: ExamSection, topics: TopicRef[]) =>
  topics.filter((t) => t.group === section.group && !/essay|extended response/i.test(t.title));

/** Spreads `count` questions over the topics as evenly as possible, earlier topics first. */
export function distribute(topics: TopicRef[], count: number): { topic: TopicRef; n: number }[] {
  if (!topics.length) return [];
  const base = Math.floor(count / topics.length);
  const extra = count % topics.length;
  return topics.map((topic, i) => ({ topic, n: base + (i < extra ? 1 : 0) })).filter((x) => x.n > 0);
}

/** Groups topic quotas into generation batches of at most `max` questions each. */
export function batches(plan: { topic: TopicRef; n: number }[], max = 10): { topic: TopicRef; n: number }[][] {
  const out: { topic: TopicRef; n: number }[][] = [];
  let cur: { topic: TopicRef; n: number }[] = [];
  let size = 0;
  for (const p of plan) {
    let left = p.n;
    while (left > 0) {
      const take = Math.min(left, max - size);
      cur.push({ topic: p.topic, n: take });
      size += take;
      left -= take;
      if (size === max) {
        out.push(cur);
        cur = [];
        size = 0;
      }
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Raw share → scaled score. Real conversion tables aren't public, so this is piecewise linear
 * through the bottom of the scale, the passing score at `passMark`, and the top.
 */
export function scaledScore(format: ExamFormat, share: number): number | null {
  const sc = format.scale;
  if (!sc) return null;
  const x = Math.max(0, Math.min(1, share));
  const v = x <= format.passMark ? sc.min + (x / format.passMark) * (sc.pass - sc.min) : sc.pass + ((x - format.passMark) / (1 - format.passMark)) * (sc.max - sc.pass);
  return Math.round(v);
}

/** Question ranges per part; the last part takes whatever the earlier ones leave. */
export function partRanges(parts: SectionPart[] | undefined, calculator: boolean, total: number): Omit<ResolvedPart, "minutes">[] {
  if (!parts?.length) return [{ from: 0, to: total, calculator }];
  let from = 0;
  return parts.map((p, i) => {
    const to = i === parts.length - 1 ? total : Math.min(total, from + (p.questions ?? total - from));
    const r = { from, to, calculator: p.calculator };
    from = to;
    return r;
  });
}

/** Parts with minutes in proportion to their questions; the last part gets the remainder. */
export function resolveParts(section: ExamSection, length: ExamLength): ResolvedPart[] {
  const total = section.questions[length];
  const minutes = section.minutes[length];
  const ranges = partRanges(section.parts, section.calculator, total);
  let left = minutes;
  return ranges.map((r, i) => {
    const m = i === ranges.length - 1 ? left : Math.round((minutes * (r.to - r.from)) / total);
    left -= m;
    return { ...r, minutes: m };
  });
}

export const hasCalculator = (section: ExamSection) => (section.parts ?? [{ calculator: section.calculator }]).some((p) => p.calculator);
