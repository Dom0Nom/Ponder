import type { Question, Response } from "../questions/types";

export const TASK_TYPES = ["choice", "truefalse", "cloze", "match", "order", "table", "calc", "open", "reading"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const LABEL_STYLES = ["abc", "ABC", "123", "box"] as const;
export type LabelStyle = (typeof LABEL_STYLES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const PRESET_IDS = ["international", "arbeitsblatt", "klassenarbeit", "ihk", "ged", "us"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export type GradeScaleId = "none" | "notenschluessel" | "letter" | "ged";

/** Fill-in gaps in a text (Lückentext), optionally with a word bank. */
export interface ClozePart {
  kind: "cloze";
  /** text with {1}, {2}… marking the gaps */
  text: string;
  blanks: { accepted: string[] }[];
}

/** A table with gaps (Tabelle ausfüllen): "" cells are the gaps. */
export interface TablePart {
  kind: "tablefill";
  columns: string[];
  rows: string[][];
  /** accepted answers per gap, in reading order */
  blanks: { accepted: string[] }[];
}

export interface OpenPart {
  kind: "open";
  prompt: string;
  /** model answer the grader compares against */
  key: string;
  /** what earns points, one line per criterion */
  rubric: string[];
  /** answer lines on paper */
  lines: number;
  /** Operator (Nenne, Erkläre…) */
  operator?: string;
  /** Anforderungsbereich I–III */
  level?: 1 | 2 | 3;
}

export type Part = Question | ClozePart | TablePart | OpenPart;

export type PartResponse = Response | { kind: "cloze"; texts: string[] } | { kind: "tablefill"; texts: string[] } | { kind: "open"; text: string };

export interface Task {
  id: string;
  type: TaskType;
  /** instruction line printed above the task */
  instruction: string;
  points: number;
  level?: 1 | 2 | 3;
  passage?: string;
  /** word bank (Wörter im Kasten) for cloze */
  bank?: string[];
  /** blank space for the calculation (Rechenweg) */
  workLines?: number;
  /** false statements must be corrected (Richtig/Falsch + Korrigiere) */
  correctFalse?: boolean;
  parts: Part[];
}

export interface GradeScale {
  id: GradeScaleId;
  /** minimum share of points, in percent, for each grade from best to second worst; the last grade has no minimum */
  thresholds: number[];
}

export interface SheetOptions {
  preset: PresetId;
  language: string;
  difficulty: Difficulty;
  /** target total points (points mode) or number of tasks (length mode) */
  mode: "points" | "length";
  totalPoints: number;
  taskCount: number;
  taskTypes: TaskType[];
  labelStyle: LabelStyle;
  optionCount: number;
  /** more than one correct option allowed in choice tasks */
  multiCorrect: boolean;
  /** with a word bank for cloze */
  wordBank: boolean;
  topic: string;
  source: "sources" | "topic" | "mistakes" | "chat";
  /** show the Rechenweg space and lines on paper */
  scale: GradeScale;
  paper: "a4" | "letter";
}

export interface Sheet {
  title: string;
  instructions: string;
  tasks: Task[];
  options: SheetOptions;
  /** which topic/source titles the sheet draws on */
  sources?: string[];
}

export interface OpenGrade {
  points: number;
  max: number;
  reason: string;
}

export interface Attempt {
  /** response per task, per part */
  responses: Record<string, (PartResponse | null)[]>;
  /** model-graded open parts, keyed "taskId:partIndex" */
  open: Record<string, OpenGrade>;
  checkedAt: number | null;
}

export interface WorksheetDoc {
  id: string;
  spaceId: string;
  title: string;
  sheet: Sheet;
  attempt: Attempt | null;
  createdAt: number;
  updatedAt: number;
}

export const emptyAttempt = (): Attempt => ({ responses: {}, open: {}, checkedAt: null });
