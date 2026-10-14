export const QUESTION_KINDS = ["mc", "multi", "fill", "dropdown", "drag", "hotspot"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export type ChartSpec =
  | { type: "bar"; title?: string; xLabel?: string; yLabel?: string; categories: string[]; series: { name: string; values: number[] }[] }
  | { type: "line"; title?: string; xLabel?: string; yLabel?: string; categories: string[]; series: { name: string; values: number[] }[] }
  | { type: "scatter"; title?: string; xLabel?: string; yLabel?: string; series: { name: string; points: [number, number][] }[] };

export type Stimulus =
  | { type: "passage"; title?: string; text: string }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "chart"; chart: ChartSpec }
  | { type: "plane"; xMin: number; xMax: number; yMin: number; yMax: number; points?: { x: number; y: number; label?: string }[]; lines?: { m: number; b: number }[] };

export type Region =
  | { shape: "circle"; x: number; y: number; r: number }
  | { shape: "rect"; x: number; y: number; w: number; h: number }
  | { shape: "cell"; row: number; col: number };

interface Base {
  prompt: string;
  explanation?: string;
  points?: number;
  topicId?: string | null;
  stimulus?: Stimulus;
}

export interface McQuestion extends Base {
  kind: "mc";
  options: string[];
  answer: number;
}
export interface MultiQuestion extends Base {
  kind: "multi";
  options: string[];
  answers: number[];
}
export interface FillQuestion extends Base {
  kind: "fill";
  /** accepted answers; numbers are compared as numbers */
  accepted: string[];
  numeric?: boolean;
}
export interface DropdownQuestion extends Base {
  kind: "dropdown";
  /** text with {1}, {2}… marking the blanks */
  text: string;
  blanks: { options: string[]; answer: number }[];
}
export interface DragQuestion extends Base {
  kind: "drag";
  mode: "order" | "categorize";
  items: string[];
  /** order: item indexes in correct order; categorize: category index per item */
  correctOrder?: number[];
  categories?: string[];
  correctCategory?: number[];
}
export interface HotspotQuestion extends Base {
  kind: "hotspot";
  region: Region;
}

export type Question = McQuestion | MultiQuestion | FillQuestion | DropdownQuestion | DragQuestion | HotspotQuestion;

export type Response =
  | { kind: "mc"; choice: number }
  | { kind: "multi"; choices: number[] }
  | { kind: "fill"; text: string }
  | { kind: "dropdown"; picks: (number | null)[] }
  /** order: item indexes in the learner's order; categorize: category per item, -1 = not placed */
  | { kind: "drag"; order?: number[]; placed?: number[] }
  | { kind: "hotspot"; x?: number; y?: number; row?: number; col?: number };

export interface Credit {
  /** 0..1 */
  credit: number;
  correct: boolean;
  answered: boolean;
}
