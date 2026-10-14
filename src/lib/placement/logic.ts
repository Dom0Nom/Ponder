import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import { repairQuestions, type CheckStats, type Solver } from "../quality/answerCheck";
import type { QuizQuestion, TopicCoverage, TopicLevelValue, TopicRef } from "../types";

export type CoverageLevel = "covered" | "partial" | "missing";

/** all-MiniLM-L6-v2 cosine (other models are mapped onto it in Rust): on-topic chunks score ~0.6, unrelated ones ≤ 0.15 (see real_model_coverage_calibration). */
export const COVERED_SIM = 0.5;
export const PARTIAL_SIM = 0.3;

export function coverageLevel(c: TopicCoverage | undefined): CoverageLevel {
  if (!c) return "missing";
  if (c.similarity != null) {
    if (c.similarity >= COVERED_SIM || (c.similarity >= PARTIAL_SIM && c.keywordHits >= 2)) return "covered";
    if (c.similarity >= PARTIAL_SIM || c.keywordHits >= 1) return "partial";
    return "missing";
  }
  if (c.keywordHits >= 3) return "covered";
  if (c.keywordHits >= 1) return "partial";
  return "missing";
}

export const topicQuery = (t: TopicRef) => `${t.title}: ${t.description}`;

/** Accepts the model's quiz JSON only when every question is answerable as given. */
export function parseQuiz(text: string, topicIds: string[]): QuizQuestion[] {
  const raw = extractJson<unknown>(text);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions) ? (raw as { questions: unknown[] }).questions : null;
  if (!list) throw new Error("The model didn't return a usable quiz. Try again.");
  const out: QuizQuestion[] = [];
  for (const q of list) {
    if (!q || typeof q !== "object") continue;
    const o = q as Record<string, unknown>;
    const options = Array.isArray(o.options) ? o.options.map(String).map((s) => s.trim()).filter(Boolean) : [];
    const answer = Number(o.answer);
    if (typeof o.question !== "string" || !o.question.trim() || options.length < 2 || options.length > 6) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    if (new Set(options).size !== options.length) continue;
    const topicId = typeof o.topicId === "string" && topicIds.includes(o.topicId) ? o.topicId : topicIds.length === 1 ? topicIds[0] : null;
    out.push({ topicId, question: o.question.trim(), options, answer, explanation: typeof o.explanation === "string" ? o.explanation.trim() : "" });
  }
  if (!out.length) throw new Error("The model's quiz had no valid questions. Try again.");
  return out;
}

export async function generateQuiz(
  llm: ResolvedModel,
  opts: {
    topics: TopicRef[];
    perTopic: number;
    context?: string;
    language?: string;
    purpose: string;
    signal?: AbortSignal;
    /** when set, each question is solved blind and failures are rewritten once */
    solver?: Solver | null;
    stats?: CheckStats;
  },
): Promise<QuizQuestion[]> {
  const write = async (topics: TopicRef[], per: number) => {
    const topicList = topics.map((t) => `- id "${t.id}": ${t.title} (${t.description})`).join("\n");
    const prompt = [
      `Write a multiple-choice quiz for a learner. Purpose: ${opts.purpose}`,
      `Topics (write exactly ${per} question${per > 1 ? "s" : ""} per topic, ${per * topics.length} in total, from easy to medium):`,
      topicList,
      opts.context ? `Base the questions on this material:\n"""\n${opts.context.slice(0, 9000)}\n"""` : "",
      "Each question has exactly 4 options, one correct answer (0-based index), and a one-sentence explanation. Questions must be answerable without seeing a picture. Avoid 'all of the above'.",
      opts.language && opts.language !== "en" ? `Write the quiz in the language with ISO code "${opts.language}".` : "",
      'Return JSON only: [{"topicId": "…", "question": "…", "options": ["…","…","…","…"], "answer": 0, "explanation": "…"}]',
    ]
      .filter(Boolean)
      .join("\n\n");
    const r = await generateText({ model: llm.model, prompt, abortSignal: opts.signal, ...llm.options({ thinking: false }) });
    return capPerTopic(parseQuiz(r.text, topics.map((t) => t.id)), per).map((q) => shuffleOptions(q));
  };
  const quiz = await write(opts.topics, opts.perTopic);
  if (!opts.solver) return quiz;
  return repairQuestions(quiz, {
    solver: opts.solver,
    signal: opts.signal,
    stats: opts.stats,
    regenerate: async (bad) => {
      const need = new Map<string | null, number>();
      for (const q of bad) need.set(q.topicId, (need.get(q.topicId) ?? 0) + 1);
      const topics = opts.topics.filter((t) => need.has(t.id));
      const fresh = await write(topics.length ? topics : opts.topics, Math.max(...need.values()));
      const seen = new Map<string | null, number>();
      return fresh.filter((q) => {
        const n = seen.get(q.topicId) ?? 0;
        seen.set(q.topicId, n + 1);
        return n < (need.get(q.topicId) ?? 0);
      });
    },
  });
}

/** Models sometimes write more questions than asked; keep the first `per` for each topic. */
export function capPerTopic<T extends { topicId: string | null }>(qs: T[], per: number): T[] {
  const seen = new Map<string | null, number>();
  return qs.filter((q) => {
    const n = seen.get(q.topicId) ?? 0;
    seen.set(q.topicId, n + 1);
    return n < per;
  });
}

/** Models tend to put the right answer first; shuffle so position isn't a tell. */
export function shuffleOptions(q: QuizQuestion, rand = Math.random): QuizQuestion {
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

export interface TopicResult {
  topicId: string;
  correct: number;
  total: number;
  level: TopicLevelValue;
}

export function levelFor(correct: number, total: number): TopicLevelValue {
  if (total === 0) return "unknown";
  const r = correct / total;
  if (r >= 0.99) return "strong";
  if (r >= 0.5) return "ok";
  return "weak";
}

export function gradeQuiz(questions: QuizQuestion[], answers: (number | null)[]): { score: number; byTopic: TopicResult[] } {
  const acc = new Map<string, { correct: number; total: number }>();
  let correct = 0;
  questions.forEach((q, i) => {
    const ok = answers[i] === q.answer;
    if (ok) correct++;
    if (q.topicId) {
      const e = acc.get(q.topicId) ?? { correct: 0, total: 0 };
      e.total++;
      if (ok) e.correct++;
      acc.set(q.topicId, e);
    }
  });
  return {
    score: questions.length ? correct / questions.length : 0,
    byTopic: [...acc.entries()].map(([topicId, e]) => ({ topicId, ...e, level: levelFor(e.correct, e.total) })),
  };
}

/** A placement test covers every group but stays short: up to `max` topics, spread across groups. */
export function pickPlacementTopics(topics: TopicRef[], max = 8): TopicRef[] {
  const groups = new Map<string, TopicRef[]>();
  for (const t of topics) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  const out: TopicRef[] = [];
  for (let round = 0; out.length < Math.min(max, topics.length); round++) {
    for (const list of groups.values()) {
      // spread picks across each group: first, last, middle, …
      const idx = [0, list.length - 1, Math.floor(list.length / 2), 1, list.length - 2][round];
      const t = idx != null ? list[idx] : list[round];
      if (t && !out.includes(t) && out.length < max) out.push(t);
    }
    if (round > 10) break;
  }
  return out;
}

export interface Chapter {
  title: string;
  start: number;
  end: number;
}

const CHAPTER_LINE = /^(?:#{1,2}\s+(.+)|((?:chapter|kapitel|unit|part|teil|lesson|lektion)\s+[\dIVXLC]+\b.*))$/i;

/**
 * Finds chapters in an imported book: Markdown headings (EPUB/DOCX imports) or "Chapter N" lines
 * (PDF text). Offsets are JS string indices into the source text.
 */
export function detectChapters(text: string, minChars = 400): Chapter[] {
  const heads: { title: string; start: number }[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const m = line.trim().match(CHAPTER_LINE);
    if (m) heads.push({ title: (m[1] ?? m[2]).replace(/\s+/g, " ").trim().slice(0, 120), start: pos });
    pos += line.length + 1;
  }
  const chapters: Chapter[] = heads.map((h, i) => ({ title: h.title, start: h.start, end: heads[i + 1]?.start ?? text.length }));
  const merged: Chapter[] = [];
  for (const c of chapters) {
    const prev = merged[merged.length - 1];
    if (prev && prev.end - prev.start < minChars) {
      // a short heading (book title, part title) folds into the chapter that follows it
      prev.end = c.end;
      prev.title = c.title;
    }
    else merged.push({ ...c });
  }
  if (merged.length && merged[merged.length - 1].end - merged[merged.length - 1].start < minChars && merged.length > 1) {
    const last = merged.pop()!;
    merged[merged.length - 1].end = last.end;
  }
  return merged.length >= 2 ? merged : [];
}
