import { fillMatches, gradeQuestion, answerText, responseText } from "../questions/grade";
import type { Attempt, ClozePart, OpenGrade, Part, PartResponse, Sheet, Task, TablePart } from "./types";

export const isOpen = (p: Part): p is Extract<Part, { kind: "open" }> => p.kind === "open";
export const openKey = (taskId: string, partIndex: number) => `${taskId}:${partIndex}`;

function gapsCredit(blanks: { accepted: string[] }[], texts: string[]): { credit: number; answered: boolean } {
  const right = blanks.filter((b, i) => fillMatches(b.accepted, texts[i] ?? "")).length;
  return { credit: blanks.length ? right / blanks.length : 0, answered: texts.some((t) => t.trim()) };
}

/** 0..1 credit for one part. Open parts come from `openGrades` (the model-graded points) and are 0 until graded. */
export function partCredit(task: Task, pi: number, response: PartResponse | null | undefined, openGrades: Record<string, OpenGrade> = {}): { credit: number; answered: boolean } {
  const part = task.parts[pi];
  if (part.kind === "open") {
    const g = openGrades[openKey(task.id, pi)];
    const text = response?.kind === "open" ? response.text : "";
    return { credit: g && g.max > 0 ? Math.max(0, Math.min(1, g.points / g.max)) : 0, answered: !!text.trim() };
  }
  if (part.kind === "cloze" || part.kind === "tablefill") {
    const texts = response && (response.kind === "cloze" || response.kind === "tablefill") ? response.texts : [];
    return gapsCredit(part.blanks, texts);
  }
  const g = gradeQuestion(part, response && response.kind !== "cloze" && response.kind !== "tablefill" && response.kind !== "open" ? response : null);
  return { credit: g.credit, answered: g.answered };
}

/** Points per part: the task's points split evenly over its parts, so a task is the mean of its parts' credit. */
export const partPoints = (task: Task) => task.points / task.parts.length;

export interface TaskScore {
  taskId: string;
  points: number;
  max: number;
  credits: number[];
}

export function scoreTask(task: Task, responses: (PartResponse | null)[] | undefined, openGrades: Record<string, OpenGrade> = {}): TaskScore {
  const credits = task.parts.map((_, i) => partCredit(task, i, responses?.[i], openGrades).credit);
  const points = Math.round(credits.reduce((n, c) => n + c * partPoints(task), 0) * 4) / 4;
  return { taskId: task.id, points, max: task.points, credits };
}

export interface SheetScore {
  tasks: TaskScore[];
  points: number;
  max: number;
  share: number;
  /** open parts still waiting for the model */
  ungraded: number;
}

export function scoreSheet(sheet: Sheet, attempt: Attempt | null): SheetScore {
  const tasks = sheet.tasks.map((t) => scoreTask(t, attempt?.responses[t.id], attempt?.open));
  const points = tasks.reduce((n, t) => n + t.points, 0);
  const max = sheet.tasks.reduce((n, t) => n + t.points, 0);
  let ungraded = 0;
  for (const t of sheet.tasks)
    t.parts.forEach((p, i) => {
      if (p.kind === "open" && attempt?.responses[t.id]?.[i] && !attempt.open[openKey(t.id, i)]) ungraded++;
    });
  return { tasks, points, max, share: max ? points / max : 0, ungraded };
}

/** The key for a part, as text (for the answer sheet and mistake notes). */
export function partKey(part: Part): string {
  if (part.kind === "cloze") return part.blanks.map((b, i) => `${i + 1}: ${b.accepted[0]}`).join("; ");
  if (part.kind === "tablefill") return part.blanks.map((b) => b.accepted[0]).join("; ");
  if (part.kind === "open") return part.key;
  return answerText(part);
}

export function partAnswerText(part: Part, r: PartResponse | null | undefined): string {
  if (!r) return "";
  if (part.kind === "cloze" || part.kind === "tablefill") return r.kind === "cloze" || r.kind === "tablefill" ? r.texts.join("; ") : "";
  if (part.kind === "open") return r.kind === "open" ? r.text : "";
  return r.kind === "cloze" || r.kind === "tablefill" || r.kind === "open" ? "" : responseText(part, r);
}

export const partPrompt = (part: Part): string => (part.kind === "cloze" ? part.text : part.kind === "tablefill" ? part.columns.join(" | ") : part.kind === "open" ? part.prompt : part.kind === "dropdown" ? part.text : part.prompt);

export type { ClozePart, TablePart };
