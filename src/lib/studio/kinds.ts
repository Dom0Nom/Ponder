import { extractJson } from "../chat/json";

export const OUTPUT_KINDS = ["report", "cheatsheet", "worksheet", "timeline", "table", "mindmap", "diagram", "slides", "infographic"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export interface ReportData {
  markdown: string;
  sources: string[];
}
export interface CheatsheetData {
  markdown: string;
}
export interface WorksheetQuestion {
  q: string;
  kind: "short" | "choice" | "fill";
  options?: string[];
  answer: string;
}
export interface WorksheetData {
  instructions: string;
  questions: WorksheetQuestion[];
}
export interface TimelineEvent {
  date: string;
  title: string;
  detail: string;
}
export interface TimelineData {
  events: TimelineEvent[];
}
export interface TableData {
  caption: string;
  columns: string[];
  rows: string[][];
}
export interface MindNode {
  label: string;
  children: MindNode[];
}
export interface MindmapData {
  root: MindNode;
}
export interface DiagramData {
  code: string;
}
export interface Slide {
  title: string;
  bullets: string[];
  notes: string;
}
export interface SlidesData {
  slides: Slide[];
}
export interface InfographicData {
  subtitle: string;
  stats: { value: string; label: string }[];
  sections: { heading: string; points: string[] }[];
  takeaway: string;
}

export interface OutputDataMap {
  report: ReportData;
  cheatsheet: CheatsheetData;
  worksheet: WorksheetData;
  timeline: TimelineData;
  table: TableData;
  mindmap: MindmapData;
  diagram: DiagramData;
  slides: SlidesData;
  infographic: InfographicData;
}
export type OutputData = OutputDataMap[OutputKind];

export interface Parsed<K extends OutputKind> {
  title: string;
  data: OutputDataMap[K];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

function mindNode(v: unknown, depth: number): MindNode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const label = str(o.label);
  if (!label) return null;
  const kids = depth >= 3 || !Array.isArray(o.children) ? [] : o.children.map((c) => mindNode(c, depth + 1)).filter((c): c is MindNode => !!c);
  return { label, children: kids.slice(0, 8) };
}

const countNodes = (n: MindNode): number => 1 + n.children.reduce((a, c) => a + countNodes(c), 0);

/** Strips a fenced block and checks the diagram starts with a Mermaid diagram type we render well. */
export function cleanMermaid(code: string): string | null {
  const c = code
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|timeline|mindmap|journey|pie)\b/.test(c) ? c : null;
}

/** Validates a model reply for one output kind; null when it is unusable. */
export function parseOutput<K extends OutputKind>(kind: K, text: string): Parsed<K> | null {
  const o = extractJson<Record<string, unknown>>(text);
  if (!o || Array.isArray(o)) return null;
  const title = str(o.title);
  if (!title) return null;
  const done = (data: OutputData) => ({ title, data }) as Parsed<K>;
  switch (kind) {
    case "report": {
      const markdown = str(o.markdown);
      return words(markdown) >= 80 ? done({ markdown, sources: strs(o.sources) }) : null;
    }
    case "cheatsheet": {
      const markdown = str(o.markdown);
      return words(markdown) >= 40 ? done({ markdown }) : null;
    }
    case "worksheet": {
      const qs: WorksheetQuestion[] = (Array.isArray(o.questions) ? o.questions : []).flatMap((x) => {
        const q = x as Record<string, unknown>;
        const kind = q.kind === "choice" || q.kind === "fill" ? q.kind : "short";
        const options = strs(q.options);
        const item = { q: str(q.q), kind, answer: str(q.answer), ...(kind === "choice" ? { options } : {}) } as WorksheetQuestion;
        if (!item.q || !item.answer) return [];
        if (kind === "choice" && (options.length < 2 || !options.includes(item.answer))) return [];
        return [item];
      });
      return qs.length >= 3 ? done({ instructions: str(o.instructions), questions: qs }) : null;
    }
    case "timeline": {
      const events = (Array.isArray(o.events) ? o.events : [])
        .map((x) => {
          const e = x as Record<string, unknown>;
          return { date: str(e.date), title: str(e.title), detail: str(e.detail) };
        })
        .filter((e) => e.date && e.title);
      return events.length >= 3 ? done({ events }) : null;
    }
    case "table": {
      const columns = strs(o.columns);
      if (columns.length < 2) return null;
      const rows = (Array.isArray(o.rows) ? o.rows : [])
        .filter(Array.isArray)
        .map((r) => columns.map((_, i) => str((r as unknown[])[i])))
        .filter((r) => r.some(Boolean));
      return rows.length >= 2 ? done({ caption: str(o.caption), columns, rows }) : null;
    }
    case "mindmap": {
      const root = mindNode(o.root, 0);
      return root && root.children.length >= 2 && countNodes(root) >= 6 ? done({ root }) : null;
    }
    case "diagram": {
      const code = cleanMermaid(str(o.code));
      return code ? done({ code }) : null;
    }
    case "slides": {
      const slides = (Array.isArray(o.slides) ? o.slides : [])
        .map((x) => {
          const sl = x as Record<string, unknown>;
          return { title: str(sl.title), bullets: strs(sl.bullets).slice(0, 6), notes: str(sl.notes) };
        })
        .filter((sl) => sl.title);
      return slides.length >= 3 ? done({ slides }) : null;
    }
    case "infographic": {
      const stats = (Array.isArray(o.stats) ? o.stats : [])
        .map((x) => {
          const st = x as Record<string, unknown>;
          return { value: str(st.value), label: str(st.label) };
        })
        .filter((st) => st.value && st.label)
        .slice(0, 4);
      const sections = (Array.isArray(o.sections) ? o.sections : [])
        .map((x) => {
          const se = x as Record<string, unknown>;
          return { heading: str(se.heading), points: strs(se.points).slice(0, 4) };
        })
        .filter((se) => se.heading && se.points.length)
        .slice(0, 4);
      return sections.length >= 2 ? done({ subtitle: str(o.subtitle), stats, sections, takeaway: str(o.takeaway) }) : null;
    }
  }
  return null;
}
