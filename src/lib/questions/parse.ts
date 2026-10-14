import { extractJson } from "../chat/json";
import type { ChartSpec, DragQuestion, Question, QuestionKind, Region, Stimulus } from "./types";
import { QUESTION_KINDS } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN);
const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "number" ? x : Number(x))) : []);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function parseChart(o: Obj): ChartSpec | null {
  const type = o.type;
  const base = { title: str(o.title) || undefined, xLabel: str(o.xLabel) || undefined, yLabel: str(o.yLabel) || undefined };
  const series = Array.isArray(o.series) ? o.series.filter(isObj) : [];
  if (type === "scatter") {
    const s = series
      .map((x) => ({ name: str(x.name), points: (Array.isArray(x.points) ? x.points : []).map((p) => nums(p).slice(0, 2)).filter((p) => p.length === 2 && p.every(finite)) as [number, number][] }))
      .filter((x) => x.points.length);
    return s.length ? { type, ...base, series: s } : null;
  }
  if (type !== "bar" && type !== "line") return null;
  const categories = strs(o.categories);
  const s = series.map((x) => ({ name: str(x.name), values: nums(x.values) })).filter((x) => x.values.length === categories.length && x.values.every(finite));
  return categories.length >= 2 && s.length ? { type, ...base, categories, series: s } : null;
}

export function parseStimulus(raw: unknown): Stimulus | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.type === "passage") {
    const text = str(raw.text);
    return text ? { type: "passage", title: str(raw.title) || undefined, text } : undefined;
  }
  if (raw.type === "table") {
    const columns = strs(raw.columns);
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).map((r) => (Array.isArray(r) ? r.map(str) : [])).filter((r) => r.length === columns.length);
    return columns.length && rows.length ? { type: "table", title: str(raw.title) || undefined, columns, rows } : undefined;
  }
  if (raw.type === "chart") {
    const chart = parseChart(isObj(raw.chart) ? raw.chart : raw);
    return chart ? { type: "chart", chart } : undefined;
  }
  if (raw.type === "plane") {
    const [xMin, xMax, yMin, yMax] = [raw.xMin, raw.xMax, raw.yMin, raw.yMax].map(Number);
    if (![xMin, xMax, yMin, yMax].every(Number.isFinite) || xMin >= xMax || yMin >= yMax) return undefined;
    const points = (Array.isArray(raw.points) ? raw.points : []).filter(isObj).filter((p) => finite(p.x) && finite(p.y)).map((p) => ({ x: p.x as number, y: p.y as number, label: str(p.label) || undefined }));
    const lines = (Array.isArray(raw.lines) ? raw.lines : []).filter(isObj).filter((l) => finite(l.m) && finite(l.b)).map((l) => ({ m: l.m as number, b: l.b as number }));
    return { type: "plane", xMin, xMax, yMin, yMax, points, lines };
  }
  return undefined;
}

function parseRegion(raw: unknown): Region | null {
  if (!isObj(raw)) return null;
  if (raw.shape === "circle" && finite(raw.x) && finite(raw.y) && finite(raw.r) && raw.r > 0) return { shape: "circle", x: raw.x, y: raw.y, r: raw.r };
  if (raw.shape === "rect" && finite(raw.x) && finite(raw.y) && finite(raw.w) && finite(raw.h)) return { shape: "rect", x: raw.x, y: raw.y, w: raw.w, h: raw.h };
  if (raw.shape === "cell" && Number.isInteger(raw.row) && Number.isInteger(raw.col)) return { shape: "cell", row: raw.row as number, col: raw.col as number };
  return null;
}

const isPermutation = (a: number[], n: number) => a.length === n && new Set(a).size === n && a.every((v) => Number.isInteger(v) && v >= 0 && v < n);

/** Validates one model-written question; null when it can't be answered or graded as given. */
export function parseQuestion(raw: unknown): Question | null {
  if (!isObj(raw)) return null;
  const prompt = str(raw.prompt) || str(raw.question);
  if (!prompt) return null;
  const kind = (str(raw.kind) || "mc") as QuestionKind;
  if (!QUESTION_KINDS.includes(kind)) return null;
  const common = {
    prompt,
    explanation: str(raw.explanation) || undefined,
    points: finite(raw.points) && raw.points > 0 ? raw.points : undefined,
    topicId: str(raw.topicId) || null,
    stimulus: parseStimulus(raw.stimulus),
  };
  if (kind === "mc" || kind === "multi") {
    const options = strs(raw.options);
    if (options.length < 2 || options.length > 8 || new Set(options).size !== options.length) return null;
    if (kind === "mc") {
      const answer = int(raw.answer);
      return answer >= 0 && answer < options.length ? { kind, ...common, options, answer } : null;
    }
    const answers = [...new Set(nums(raw.answers ?? raw.answer).map(Number))];
    return answers.length && answers.every((a) => Number.isInteger(a) && a >= 0 && a < options.length) && answers.length < options.length ? { kind, ...common, options, answers } : null;
  }
  if (kind === "fill") {
    const accepted = strs(raw.accepted ?? raw.answers ?? raw.answer);
    return accepted.length ? { kind, ...common, accepted, numeric: raw.numeric === true || undefined } : null;
  }
  if (kind === "dropdown") {
    const text = str(raw.text) || prompt;
    const blanks = (Array.isArray(raw.blanks) ? raw.blanks : []).filter(isObj).map((b) => ({ options: strs(b.options), answer: int(b.answer) }));
    if (!blanks.length || blanks.some((b) => b.options.length < 2 || !(b.answer >= 0 && b.answer < b.options.length))) return null;
    for (let i = 1; i <= blanks.length; i++) if (!text.includes(`{${i}}`)) return null;
    return { kind, ...common, text, blanks };
  }
  if (kind === "drag") {
    const items = strs(raw.items);
    const mode = raw.mode === "categorize" ? "categorize" : "order";
    if (items.length < 2) return null;
    if (mode === "order") {
      const correctOrder = nums(raw.correctOrder);
      return isPermutation(correctOrder, items.length) ? ({ kind, ...common, mode, items, correctOrder } as DragQuestion) : null;
    }
    const categories = strs(raw.categories);
    const correctCategory = nums(raw.correctCategory);
    if (categories.length < 2 || correctCategory.length !== items.length || !correctCategory.every((c) => Number.isInteger(c) && c >= 0 && c < categories.length)) return null;
    return { kind, ...common, mode, items, categories, correctCategory } as DragQuestion;
  }
  const region = parseRegion(raw.region);
  return region && common.stimulus && (common.stimulus.type === "plane" || common.stimulus.type === "chart" || common.stimulus.type === "table") ? { kind: "hotspot", ...common, region } : null;
}

export function parseQuestions(text: string): Question[] {
  const raw = extractJson<unknown>(text);
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.questions) ? raw.questions : null;
  if (!list) return [];
  return list.map(parseQuestion).filter((q): q is Question => !!q);
}

/** Shuffles mc options so the key isn't always first; the answer index follows. */
export function shuffleChoices<T extends Question>(q: T, rand: () => number = Math.random): T {
  if (q.kind !== "mc" && q.kind !== "multi") return q;
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const options = order.map((i) => q.options[i]);
  if (q.kind === "mc") return { ...q, options, answer: order.indexOf(q.answer) };
  return { ...q, options, answers: q.answers.map((a) => order.indexOf(a)).sort((a, b) => a - b) };
}
