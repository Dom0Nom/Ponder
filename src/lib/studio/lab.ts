import { compile } from "../plot/parser";
import { extractJson } from "../chat/json";

export interface LabParam {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
}
export interface LabCurve {
  label: string;
  expr: string;
}
export interface LabVersion {
  at: number;
  values: Record<string, number>;
}
export interface LabData {
  description: string;
  xLabel: string;
  yLabel: string;
  xMin: number;
  xMax: number;
  params: LabParam[];
  curves: LabCurve[];
  /** Slider positions the card reopens with. */
  current: Record<string, number>;
  versions: LabVersion[];
}

const MAX_PARAMS = 6;
const MAX_CURVES = 4;
const MAX_VERSIONS = 20;
const RESERVED = /^(x|e|pi|ans|asin|acos|atan|sin|cos|tan|sqrt|abs|ln|log|exp|floor|ceil)$/i;
const ID = /^[a-z][a-z0-9_]{0,11}$/i;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const clampTo = (p: LabParam, v: number) => {
  const snapped = p.min + Math.round((Math.min(p.max, Math.max(p.min, v)) - p.min) / p.step) * p.step;
  return Math.min(p.max, Math.max(p.min, Number(snapped.toFixed(6))));
};

/** Replaces parameter names with their values so the plot parser only sees `x`. */
export function substitute(expr: string, values: Record<string, number>): string {
  return expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => (name in values ? `(${values[name]})` : name));
}

export function compileCurve(expr: string, values: Record<string, number>): ((x: number) => number) | null {
  const r = compile(substitute(expr, values));
  if (!r.ok) return null;
  const env = { x: 0, ans: 0 };
  return (x) => {
    env.x = x;
    return r.value.eval(env);
  };
}

export function currentValues(d: LabData): Record<string, number> {
  return Object.fromEntries(d.params.map((p) => [p.id, clampTo(p, d.current[p.id] ?? p.value)]));
}

export function setValue(d: LabData, id: string, v: number): LabData {
  const p = d.params.find((x) => x.id === id);
  return p ? { ...d, current: { ...currentValues(d), [id]: clampTo(p, v) } } : d;
}

export const resetValues = (d: LabData): LabData => ({ ...d, current: {} });

/** A saved version is a snapshot of the sliders; the newest comes first and identical neighbours collapse. */
export function saveVersion(d: LabData, at = Date.now()): LabData {
  const values = currentValues(d);
  const last = d.versions[0];
  if (last && d.params.every((p) => last.values[p.id] === values[p.id])) return d;
  return { ...d, versions: [{ at, values }, ...d.versions].slice(0, MAX_VERSIONS) };
}

export const restoreVersion = (d: LabData, i: number): LabData => (d.versions[i] ? { ...d, current: { ...d.versions[i].values } } : d);

export interface Series {
  label: string;
  points: [number, number][];
}

/** Samples every curve; a curve that doesn't compile is reported in `bad`. */
export function sampleLab(d: LabData, values: Record<string, number>, n = 240): { series: Series[]; bad: string[]; yMin: number; yMax: number } {
  const series: Series[] = [];
  const bad: string[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of d.curves) {
    const f = compileCurve(c.expr, values);
    if (!f) {
      bad.push(c.label);
      continue;
    }
    const points: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const x = d.xMin + ((d.xMax - d.xMin) * i) / n;
      const y = f(x);
      if (!Number.isFinite(y)) continue;
      points.push([x, y]);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    series.push({ label: c.label, points });
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  return { series, bad, yMin: lo - pad, yMax: hi + pad };
}

/** Validates a model reply into a lab card; null when it can't be plotted. */
export function parseLab(textIn: string): { title: string; data: LabData } | null {
  const o = extractJson<Record<string, unknown>>(textIn);
  if (!o || Array.isArray(o)) return null;
  const title = text(o.title);
  const params: LabParam[] = [];
  for (const raw of Array.isArray(o.params) ? o.params : []) {
    const r = raw as Record<string, unknown>;
    const id = text(r.id);
    const min = num(r.min);
    const max = num(r.max);
    if (!ID.test(id) || RESERVED.test(id) || params.some((p) => p.id === id) || min === null || max === null || max <= min) continue;
    const step = num(r.step);
    const stepOk = step !== null && step > 0 && step <= max - min ? step : (max - min) / 100;
    const p: LabParam = { id, label: text(r.label) || id, unit: text(r.unit), min, max, step: stepOk, value: min };
    p.value = clampTo(p, num(r.value) ?? (min + max) / 2);
    params.push(p);
    if (params.length === MAX_PARAMS) break;
  }
  const xMin = num(o.xMin);
  const xMax = num(o.xMax);
  const values = Object.fromEntries(params.map((p) => [p.id, p.value]));
  const curves: LabCurve[] = [];
  for (const raw of Array.isArray(o.curves) ? o.curves : []) {
    const r = raw as Record<string, unknown>;
    const expr = text(r.expr);
    if (!expr || !compileCurve(expr, values)) continue;
    curves.push({ label: text(r.label) || expr, expr });
    if (curves.length === MAX_CURVES) break;
  }
  if (!title || !params.length || !curves.length || xMin === null || xMax === null || xMax <= xMin) return null;
  return {
    title,
    data: { description: text(o.description), xLabel: text(o.xLabel), yLabel: text(o.yLabel), xMin, xMax, params, curves, current: {}, versions: [] },
  };
}

export const LAB_SHAPE =
  '{"title": "…", "description": "2–3 sentences: what to try and what to notice", "xLabel": "Time (s)", "yLabel": "Output", "xMin": 0, "xMax": 10, "params": [{"id": "k", "label": "Gain", "unit": "", "min": 0.1, "max": 5, "step": 0.1, "value": 1}], "curves": [{"label": "Response", "expr": "1 - exp(-k*x)"}]}';

export const LAB_TASK = [
  "Build one lab card: a small model the learner explores with sliders while a plot updates. Pick the idea in the material that gains most from it (a step response, a pendulum, supply and demand, a distribution).",
  "Give 1–5 parameters. Each id is a short name of letters, digits or underscore (not x, e, pi or a function name) and the label says what it changes, with the unit if it has one.",
  "Each curve is a closed-form formula in x and the parameter ids, using only + - * / ^, parentheses, numbers, pi, e and the functions sin, cos, tan, asin, acos, atan, sqrt, abs, ln, log, exp, floor, ceil. 1–3 curves. No loops, no integrals; derive a closed form (for example a damped step response) instead of simulating.",
  "xMin and xMax set the horizontal range, with units in xLabel and yLabel. Pick start values that already show something interesting.",
];
