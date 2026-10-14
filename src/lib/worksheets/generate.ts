import { generateText } from "ai";
import { api } from "../ipc";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import { generateNoThinking } from "../steps/check";
import { gatherMaterial, NoMaterialError } from "../studio/generate";
import { checkKeys } from "../quality/keyHook";
import { s } from "../strings";
import { openKey, partPrompt } from "./grade";
import { parseSheet, parseTask } from "./parse";
import { openGradePrompt, regenerateTaskPrompt, worksheetPrompt } from "./prompts";
import type { Attempt, OpenGrade, Sheet, SheetOptions, Task } from "./types";

export { NoMaterialError };

/** Renders the studio material (numbered passages) as plain prompt text. */
export function materialText(m: { sources: string[]; passages: { source: number; text: string }[]; summaries: { source: number; summary: string }[] }): string {
  return [m.summaries.map((x) => `[${x.source}] ${x.summary}`).join("\n\n"), m.passages.map((p) => `[${p.source}] ${p.text}`).join("\n\n")].filter(Boolean).join("\n\n");
}

/** Material for a sheet from the picked origin: the space's sources, a topic, the mistake notebook or a chat. */
export async function sheetMaterial(spaceId: string, o: SheetOptions, llm?: ResolvedModel, chatThreadId?: string): Promise<{ text: string; sources: string[] }> {
  if (o.source === "mistakes") {
    const list = (await api.mistakesList(spaceId)).filter((m) => !m.resolved).slice(0, 25);
    if (!list.length) throw new NoMaterialError();
    return {
      text: list.map((m, i) => `[1] Mistake ${i + 1}: ${m.question}\nCorrect: ${m.correct}${m.explanation ? `\nWhy: ${m.explanation}` : ""}${m.given ? `\nLearner said: ${m.given}` : ""}`).join("\n\n"),
      sources: [s.worksheets.mistakeNotebook],
    };
  }
  if (o.source === "chat") {
    const threads = await api.listThreads(spaceId);
    const id = chatThreadId ?? threads[0]?.id;
    if (!id) throw new NoMaterialError();
    const msgs = (await api.listMessages(id)).slice(-24);
    const text = msgs.map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content}`).join("\n\n").slice(0, 16_000);
    if (!text.trim()) throw new NoMaterialError();
    return { text: `[1] ${text}`, sources: [threads.find((t) => t.id === id)?.title ?? s.worksheets.chat] };
  }
  const m = await gatherMaterial(spaceId, o.source === "topic" ? o.topic : o.topic, llm);
  return { text: materialText(m), sources: m.sources };
}

function questionsOf(tasks: Task[]): string[] {
  return tasks.flatMap((t) => t.parts.map(partPrompt));
}

export async function generateSheet(llm: ResolvedModel, o: SheetOptions, material: { text: string; sources: string[] }, opts: { avoid?: string[]; signal?: AbortSignal } = {}): Promise<Sheet & { replaced: number }> {
  const prompt = worksheetPrompt(o, material.text, opts.avoid);
  let lastError: unknown = null;
  for (let i = 0; i < 2; i++) {
    const r = await generateText({ model: llm.model, prompt, abortSignal: opts.signal, ...llm.options({ thinking: false }) });
    try {
      const sheet = parseSheet(r.text, o);
      const checked = await checkKeys(llm, sheet.tasks, { signal: opts.signal });
      return { ...sheet, tasks: checked.tasks, sources: material.sources, replaced: checked.replaced };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error && lastError.message !== "no tasks" && lastError.message !== "no usable tasks" ? lastError : new Error(s.worksheets.unreadable);
}

export async function regenerateTask(llm: ResolvedModel, sheet: Sheet, taskId: string, material: string, signal?: AbortSignal): Promise<Task> {
  const idx = sheet.tasks.findIndex((t) => t.id === taskId);
  const task = sheet.tasks[idx];
  if (!task) throw new Error(s.worksheets.unreadable);
  const avoid = questionsOf(sheet.tasks);
  for (let i = 0; i < 2; i++) {
    const text = await generateNoThinking(llm, { prompt: regenerateTaskPrompt(sheet.options, material, task, avoid), abortSignal: signal });
    const raw = extractJson<unknown>(text);
    const one = Array.isArray(raw) ? raw[0] : raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown[] }).tasks) ? (raw as { tasks: unknown[] }).tasks[0] : raw;
    const parsed = parseTask({ ...(one as object), type: task.type, points: task.points }, sheet.options.language, idx);
    if (parsed) return { ...parsed, id: task.id, points: task.points };
  }
  throw new Error(s.worksheets.unreadable);
}

/** Grades every answered open part with the model against its key and rubric. */
export async function gradeOpenParts(llm: ResolvedModel, sheet: Sheet, attempt: Attempt, signal?: AbortSignal): Promise<Record<string, OpenGrade>> {
  const items: { id: string; prompt: string; key: string; rubric: string[]; max: number; answer: string }[] = [];
  for (const t of sheet.tasks)
    t.parts.forEach((p, i) => {
      if (p.kind !== "open") return;
      const r = attempt.responses[t.id]?.[i];
      items.push({ id: openKey(t.id, i), prompt: p.prompt, key: p.key, rubric: p.rubric, max: Math.round((t.points / t.parts.length) * 4) / 4, answer: r?.kind === "open" ? r.text : "" });
    });
  const out: Record<string, OpenGrade> = {};
  const toGrade = items.filter((x) => x.answer.trim());
  for (const x of items) if (!x.answer.trim()) out[x.id] = { points: 0, max: x.max, reason: "" };
  if (!toGrade.length) return out;
  const text = await generateNoThinking(llm, { prompt: openGradePrompt(sheet.options.language, toGrade), abortSignal: signal });
  const raw = extractJson<unknown>(text);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { grades?: unknown[] }).grades) ? (raw as { grades: unknown[] }).grades : [];
  for (const g of list) {
    if (!g || typeof g !== "object") continue;
    const o = g as { id?: unknown; points?: unknown; reason?: unknown };
    const item = toGrade.find((x) => x.id === o.id);
    if (!item || typeof o.points !== "number") continue;
    out[item.id] = { points: Math.max(0, Math.min(item.max, Math.round(o.points * 2) / 2)), max: item.max, reason: typeof o.reason === "string" ? o.reason.trim() : "" };
  }
  const missing = toGrade.filter((x) => !out[x.id]);
  if (missing.length) throw new Error(s.worksheets.gradeUnreadable);
  return out;
}
