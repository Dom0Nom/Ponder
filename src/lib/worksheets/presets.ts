import { scaledScore, GED } from "../exam/formats";
import type { GradeScale, GradeScaleId, PresetId, SheetOptions, TaskType } from "./types";

export interface Preset {
  id: PresetId;
  /** language the preset implies; null follows the space */
  language: string | null;
  defaults: Pick<SheetOptions, "mode" | "totalPoints" | "taskCount" | "taskTypes" | "labelStyle" | "optionCount" | "multiCorrect" | "wordBank" | "difficulty"> & { scale: GradeScale; paper?: "a4" | "letter" };
}

export const DEFAULT_THRESHOLDS = {
  /** 1 (sehr gut) to 6 (ungenügend) */
  notenschluessel: [92, 81, 67, 50, 30],
  /** A to F */
  letter: [90, 80, 70, 60],
  ged: [],
  none: [],
} as const;

export const scaleOf = (id: GradeScaleId): GradeScale => ({ id, thresholds: [...DEFAULT_THRESHOLDS[id]] });

const ALL: TaskType[] = ["choice", "truefalse", "cloze", "match", "order", "table", "calc", "open", "reading"];

export const PRESETS: Record<PresetId, Preset> = {
  international: {
    id: "international",
    language: null,
    defaults: { mode: "length", totalPoints: 20, taskCount: 6, taskTypes: ["choice", "truefalse", "cloze", "open"], labelStyle: "abc", optionCount: 4, multiCorrect: false, wordBank: false, difficulty: "medium", scale: scaleOf("none") },
  },
  arbeitsblatt: {
    id: "arbeitsblatt",
    language: "de",
    defaults: { mode: "length", totalPoints: 20, taskCount: 5, taskTypes: ["choice", "cloze", "match", "open"], labelStyle: "box", optionCount: 3, multiCorrect: false, wordBank: true, difficulty: "easy", scale: scaleOf("none"), paper: "a4" },
  },
  klassenarbeit: {
    id: "klassenarbeit",
    language: "de",
    defaults: { mode: "points", totalPoints: 40, taskCount: 6, taskTypes: ["choice", "truefalse", "cloze", "calc", "open", "reading"], labelStyle: "abc", optionCount: 4, multiCorrect: false, wordBank: true, difficulty: "medium", scale: scaleOf("notenschluessel"), paper: "a4" },
  },
  ihk: {
    id: "ihk",
    language: "de",
    defaults: { mode: "points", totalPoints: 100, taskCount: 10, taskTypes: ["choice", "calc", "table", "open"], labelStyle: "ABC", optionCount: 5, multiCorrect: true, wordBank: false, difficulty: "medium", scale: scaleOf("notenschluessel"), paper: "a4" },
  },
  ged: {
    id: "ged",
    language: "en",
    defaults: { mode: "length", totalPoints: 20, taskCount: 8, taskTypes: ["choice", "cloze", "order", "match", "calc", "reading"], labelStyle: "ABC", optionCount: 4, multiCorrect: false, wordBank: false, difficulty: "medium", scale: scaleOf("ged"), paper: "letter" },
  },
  us: {
    id: "us",
    language: "en",
    defaults: { mode: "points", totalPoints: 50, taskCount: 7, taskTypes: ["choice", "truefalse", "cloze", "calc", "open"], labelStyle: "ABC", optionCount: 4, multiCorrect: false, wordBank: false, difficulty: "medium", scale: scaleOf("letter"), paper: "letter" },
  },
};

export const IHK_BOUND_NOTE = { bound: "gebundene Aufgaben", free: "ungebundene Aufgaben" };

/** IHK papers split into gebundene (closed, auto-markable) and ungebundene (open) tasks. */
export const isBound = (t: TaskType) => t === "choice" || t === "truefalse" || t === "match" || t === "order" || t === "cloze";

export function optionsFor(preset: PresetId, language: string, patch: Partial<SheetOptions> = {}): SheetOptions {
  const p = PRESETS[preset];
  return {
    preset,
    language: p.language ?? language,
    source: "sources",
    topic: "",
    ...p.defaults,
    paper: p.defaults.paper ?? "a4",
    ...patch,
  };
}

export { ALL as ALL_TASK_TYPES };

export interface GradeResult {
  label: string;
  /** 1..6 for the German scale, undefined elsewhere */
  value?: number;
}

/** Grade for a share (0..1) of the points. */
export function gradeFor(scale: GradeScale, share: number): GradeResult | null {
  const pct = share * 100 + 1e-9;
  if (scale.id === "notenschluessel") {
    const i = scale.thresholds.findIndex((t) => pct >= t);
    const g = i < 0 ? scale.thresholds.length + 1 : i + 1;
    return { label: String(g), value: g };
  }
  if (scale.id === "letter") {
    const i = scale.thresholds.findIndex((t) => pct >= t);
    return { label: i < 0 ? "F" : "ABCD"[i] };
  }
  if (scale.id === "ged") return { label: String(scaledScore(GED, share)) };
  return null;
}

/** Points needed for each grade, for the printed Notenschlüssel table. */
export function scaleRows(scale: GradeScale, total: number): { grade: string; min: number; max: number }[] {
  if (scale.id !== "notenschluessel" && scale.id !== "letter") return [];
  const names = scale.id === "letter" ? ["A", "B", "C", "D", "F"] : ["1", "2", "3", "4", "5", "6"];
  const minPts = (pct: number) => Math.ceil((pct / 100) * total - 1e-9);
  const mins = [...scale.thresholds.map(minPts), 0];
  return names.map((grade, i) => ({ grade, min: mins[i], max: i === 0 ? total : mins[i - 1] - 1 }));
}

/** Thresholds must descend and stay within 0..100. */
export function validThresholds(t: number[]): boolean {
  return t.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 100 && (i === 0 || v < t[i - 1]));
}
