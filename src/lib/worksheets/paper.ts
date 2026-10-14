import type { Part, PartResponse, Sheet } from "./types";

const letterIndex = (t: string): number => {
  const v = t.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^\d+$/.test(v)) return Number(v) - 1;
  return v.length === 1 ? v.charCodeAt(0) - 97 : -1;
};

function toResponse(part: Part, answer: string): PartResponse | null {
  const text = answer.trim();
  if (!text) return null;
  const bars = text.split("|").map((x) => x.trim());
  switch (part.kind) {
    case "mc": {
      const tf = part.options.findIndex((o) => o.toLowerCase() === text.toLowerCase());
      const i = tf >= 0 ? tf : /^(true|richtig|wahr)$/i.test(text) ? 0 : /^(false|falsch)$/i.test(text) ? 1 : letterIndex(text);
      return i >= 0 && i < part.options.length ? { kind: "mc", choice: i } : null;
    }
    case "multi": {
      const choices = [...new Set(text.split(/[,;\s]+/).map(letterIndex))].filter((i) => i >= 0 && i < part.options.length).sort((a, b) => a - b);
      return choices.length ? { kind: "multi", choices } : null;
    }
    case "fill":
      return { kind: "fill", text };
    case "cloze":
    case "tablefill":
      return { kind: part.kind, texts: bars };
    case "open":
      return { kind: "open", text };
    case "drag":
      if (part.mode === "order") {
        const pos = bars.map((b) => Number(b.replace(/\D/g, "")));
        if (pos.length !== part.items.length || pos.some((p) => !p)) return null;
        return { kind: "drag", order: part.items.map((_, i) => i).sort((a, b) => pos[a] - pos[b]) };
      }
      return { kind: "drag", placed: part.items.map((_, i) => (bars[i] ? letterIndex(bars[i]) : -1)) };
    default:
      return null;
  }
}

/** Fills responses from "task.part: answer" lines read off a photo of the paper sheet; unreadable lines are skipped. */
export function paperResponses(sheet: Sheet, lines: string[]): Record<string, (PartResponse | null)[]> {
  const out: Record<string, (PartResponse | null)[]> = {};
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s*[.\-:]\s*(\d+)\s*[:)]\s*(.*)$/s) ?? line.match(/^\s*(\d+)\s*()[:)]\s*(.*)$/s);
    if (!m) continue;
    const task = sheet.tasks[Number(m[1]) - 1];
    const pi = (m[2] ? Number(m[2]) : 1) - 1;
    const part = task?.parts[pi];
    if (!task || !part) continue;
    const r = toResponse(part, m[3]);
    if (!r) continue;
    (out[task.id] ??= task.parts.map(() => null))[pi] = r;
  }
  return out;
}
