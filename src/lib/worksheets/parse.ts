import { extractJson } from "../chat/json";
import { parseQuestion } from "../questions/parse";
import { sheetLabels } from "./labels";
import { isBound } from "./presets";
import type { ClozePart, OpenPart, Part, Sheet, SheetOptions, Task, TablePart, TaskType } from "./types";
import { TASK_TYPES } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const level = (v: unknown): 1 | 2 | 3 | undefined => (v === 1 || v === 2 || v === 3 ? v : v === "1" || v === "2" || v === "3" ? (Number(v) as 1 | 2 | 3) : undefined);

function accepted(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  return list.map(str).filter(Boolean);
}

function parseBlanks(v: unknown): { accepted: string[] }[] {
  return (Array.isArray(v) ? v : []).map((b) => ({ accepted: accepted(isObj(b) ? (b.accepted ?? b.answer) : b) }));
}

function parseCloze(o: Obj): ClozePart | null {
  const text = str(o.text);
  const blanks = parseBlanks(o.blanks);
  if (!text || !blanks.length || blanks.some((b) => !b.accepted.length)) return null;
  for (let i = 1; i <= blanks.length; i++) if (!text.includes(`{${i}}`)) return null;
  return { kind: "cloze", text, blanks };
}

function parseTable(o: Obj): TablePart | null {
  const columns = strs(o.columns);
  const rows = (Array.isArray(o.rows) ? o.rows : []).map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : str(c))) : []));
  const blanks = parseBlanks(o.blanks);
  if (columns.length < 2 || !rows.length || rows.some((r) => r.length !== columns.length)) return null;
  const gaps = rows.flat().filter((c) => c === "").length;
  if (!gaps || gaps !== blanks.length || blanks.some((b) => !b.accepted.length)) return null;
  return { kind: "tablefill", columns, rows, blanks };
}

function parseOpen(o: Obj): OpenPart | null {
  const prompt = str(o.prompt) || str(o.question);
  const key = str(o.key) || str(o.answer);
  if (!prompt || !key) return null;
  const rubric = strs(o.rubric);
  const lines = typeof o.lines === "number" && o.lines >= 1 ? Math.min(12, Math.round(o.lines)) : 3;
  return { kind: "open", prompt, key, rubric: rubric.length ? rubric : [key], lines, operator: str(o.operator) || undefined, level: level(o.level) };
}

function trueFalse(o: Obj, language: string): Part | null {
  const statement = str(o.statement) || str(o.prompt);
  if (!statement || typeof o.answer !== "boolean") return null;
  const l = sheetLabels(language);
  return { kind: "mc", prompt: statement, options: [l.trueLabel, l.falseLabel], answer: o.answer ? 0 : 1, explanation: str(o.correction) || str(o.explanation) || undefined };
}

export function parsePart(type: TaskType, raw: unknown, language: string): Part | null {
  if (!isObj(raw)) return null;
  switch (type) {
    case "choice":
      return parseQuestion(raw.kind === "multi" || raw.kind === "mc" ? raw : { ...raw, kind: Array.isArray(raw.answers) ? "multi" : "mc" });
    case "truefalse":
      return trueFalse(raw, language);
    case "cloze":
      return parseCloze(raw);
    case "match":
      return parseQuestion({ ...raw, prompt: str(raw.prompt) || sheetLabels(language).instructions.match, kind: "drag", mode: "categorize" });
    case "order":
      return parseQuestion({ ...raw, prompt: str(raw.prompt) || sheetLabels(language).instructions.order, kind: "drag", mode: "order" });
    case "table":
      return parseTable(raw);
    case "calc":
      return parseQuestion({ ...raw, kind: "fill" });
    case "open":
      return parseOpen(raw);
    case "reading": {
      if (raw.key != null && raw.rubric != null) return parseOpen(raw);
      return parseQuestion(raw);
    }
  }
}

export function parseTask(raw: unknown, language: string, index: number): Task | null {
  if (!isObj(raw)) return null;
  const type = str(raw.type) as TaskType;
  if (!TASK_TYPES.includes(type)) return null;
  const partsRaw = Array.isArray(raw.parts) ? raw.parts : [];
  const parts = partsRaw.map((p) => parsePart(type, p, language)).filter((p): p is Part => !!p);
  if (!parts.length) return null;
  const bank = strs(raw.bank);
  const l = sheetLabels(language);
  const points = typeof raw.points === "number" && raw.points > 0 ? raw.points : parts.length;
  return {
    id: `t${index + 1}`,
    type,
    instruction: str(raw.instruction) || l.instructions[type],
    points,
    level: level(raw.level),
    passage: str(raw.passage) || undefined,
    bank: type === "cloze" && bank.length ? bank : undefined,
    workLines: type === "calc" ? (typeof raw.workLines === "number" ? Math.min(12, Math.max(2, Math.round(raw.workLines))) : 4) : undefined,
    correctFalse: type === "truefalse" && raw.correctFalse === true ? true : undefined,
    parts,
  };
}

/** Scales task points to `total` in steps of 0.5; the biggest task absorbs rounding. */
export function normalizePoints(tasks: Task[], total: number): Task[] {
  const sum = tasks.reduce((n, t) => n + t.points, 0);
  if (!sum || Math.abs(sum - total) < 1e-9) return tasks;
  const out = tasks.map((t) => ({ ...t, points: Math.max(0.5, Math.round(((t.points * total) / sum) * 2) / 2) }));
  const drift = total - out.reduce((n, t) => n + t.points, 0);
  if (drift) {
    const big = out.reduce((bi, t, i) => (t.points > out[bi].points ? i : bi), 0);
    out[big] = { ...out[big], points: Math.max(0.5, out[big].points + drift) };
  }
  return out;
}

export function parseSheet(text: string, options: SheetOptions): Sheet {
  const raw = extractJson<unknown>(text);
  const o = isObj(raw) ? raw : Array.isArray(raw) ? { tasks: raw } : null;
  const list = o && Array.isArray(o.tasks) ? o.tasks : null;
  if (!o || !list) throw new Error("no tasks");
  let tasks = list.map((t, i) => parseTask(t, options.language, i)).filter((t): t is Task => !!t);
  if (!tasks.length) throw new Error("no usable tasks");
  if (options.preset === "ihk") tasks = [...tasks.filter((t) => isBound(t.type)), ...tasks.filter((t) => !isBound(t.type))];
  tasks = tasks.map((t, i) => ({ ...t, id: `t${i + 1}` }));
  if (options.mode === "points") tasks = normalizePoints(tasks, options.totalPoints);
  return { title: str(o.title) || "Worksheet", instructions: str(o.instructions), tasks, options };
}

export const totalPoints = (tasks: Task[]) => tasks.reduce((n, t) => n + t.points, 0);
