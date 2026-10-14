import type { QuizQuestion, TopicRef } from "../types";
import type { EssayGrade, EssayTask } from "./essay";
import { resolveParts, scaledScore, type ExamFormat, type ExamLength, type ExamSection } from "./formats";

export interface ExamData {
  questions: QuizQuestion[];
  answers: (number | null)[];
  flags: boolean[];
  topics: Pick<TopicRef, "id" | "title">[];
  /** time used (ms) when each part after the first began; its length is the current part index */
  partStarts?: number[];
  /** questions swapped out because the answer-key check disagreed with the key */
  replaced?: number;
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

export const ESSAY_WEIGHT = 2;
export const ESSAY_MAX = 6;

export function examResult(format: ExamFormat, data: ExamData): ExamResult {
  const correct = data.questions.filter((q, i) => data.answers[i] === q.answer).length;
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
    if (data.answers[i] === q.answer) r.correct++;
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

export interface PartClock {
  index: number;
  count: number;
  remainingMs: number;
  /** a part before the last one has run out of time */
  expired: boolean;
}

/** Clock for the current part: earlier parts have a fixed share, the last one gets all the time that is left. */
export function partClock(section: ExamSection, length: ExamLength, partStarts: number[] | undefined, usedMs: number): PartClock {
  const parts = resolveParts(section, length);
  const index = Math.min(partStarts?.length ?? 0, parts.length - 1);
  if (index === parts.length - 1) return { index, count: parts.length, remainingMs: remainingMs(section, length, usedMs), expired: false };
  const start = index === 0 ? 0 : partStarts![index - 1];
  const left = Math.max(0, start + parts[index].minutes * 60_000 - usedMs);
  return { index, count: parts.length, remainingMs: left, expired: left <= 0 };
}
