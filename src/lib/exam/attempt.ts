import { gradeQuestion } from "../questions/grade";
import type { Response } from "../questions/types";
import type { QuizQuestion, TopicRef } from "../types";
import type { EssayGrade, EssayTask } from "./essay";
import { scaledScore, type ExamFormat, type ExamSection } from "./formats";

export interface ExamData {
  questions: QuizQuestion[];
  answers: (number | null)[];
  /** raw responses for questions with `rich` set, same order as `questions` */
  responses?: (Response | null)[];
  flags: boolean[];
  topics: Pick<TopicRef, "id" | "title">[];
  essay?: { task: EssayTask; text: string; grade?: EssayGrade };
}

export interface TopicResult {
  topicId: string;
  title: string;
  correct: number;
  total: number;
}

export interface ExamResult {
  correct: number;
  total: number;
  /** essay points count double, as on the GED */
  essayPoints: number | null;
  share: number;
  scaled: number | null;
  passed: boolean;
  byTopic: TopicResult[];
}

/** Credit 0..1 for question `i`: partial for multi-select, drag and drop-down questions. */
export function creditAt(d: Pick<ExamData, "questions" | "answers" | "responses">, i: number): number {
  const q = d.questions[i];
  if (q.rich) return gradeQuestion(q.rich, d.responses?.[i]).credit;
  return d.answers[i] === q.answer ? 1 : 0;
}

export function answeredAt(d: Pick<ExamData, "questions" | "answers" | "responses">, i: number): boolean {
  const q = d.questions[i];
  return q.rich ? gradeQuestion(q.rich, d.responses?.[i]).answered : d.answers[i] != null;
}

const quarter = (n: number) => Math.round(n * 4) / 4;

export const ESSAY_WEIGHT = 2;
export const ESSAY_MAX = 6;

export function examResult(format: ExamFormat, data: ExamData): ExamResult {
  const correct = quarter(data.questions.reduce((n, _, i) => n + creditAt(data, i), 0));
  const total = data.questions.length;
  const essayPoints = data.essay ? (data.essay.grade?.total ?? 0) * ESSAY_WEIGHT : null;
  const max = total + (data.essay ? ESSAY_MAX * ESSAY_WEIGHT : 0);
  const share = max ? (correct + (essayPoints ?? 0)) / max : 0;
  const titles = new Map(data.topics.map((t) => [t.id, t.title]));
  const byTopic = new Map<string, TopicResult>();
  data.questions.forEach((q, i) => {
    const id = q.topicId ?? "";
    const r = byTopic.get(id) ?? { topicId: id, title: titles.get(id) ?? id, correct: 0, total: 0 };
    r.total++;
    r.correct = quarter(r.correct + creditAt(data, i));
    byTopic.set(id, r);
  });
  const scaled = scaledScore(format, share);
  return {
    correct,
    total,
    essayPoints,
    share,
    scaled,
    passed: scaled != null && format.scale ? scaled >= format.scale.pass : share >= format.passMark,
    byTopic: [...byTopic.values()].sort((a, b) => a.correct / a.total - b.correct / b.total),
  };
}

/** Topics under 60% with at least two questions, weakest first. */
export const weakTopics = (r: ExamResult) => r.byTopic.filter((t) => t.total >= 2 && t.correct / t.total < 0.6);

export const sectionMs = (section: ExamSection, length: "short" | "full") => section.minutes[length] * 60_000;

export function remainingMs(section: ExamSection, length: "short" | "full", timeUsedMs: number) {
  return Math.max(0, sectionMs(section, length) - timeUsedMs);
}

export function clockText(ms: number) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
