export type CellLang = "js" | "python";

const ALIASES: Record<string, CellLang> = {
  js: "js",
  javascript: "js",
  mjs: "js",
  python: "python",
  py: "python",
  python3: "python",
};

export function cellLang(className?: string): CellLang | null {
  const m = /(?:^|\s)language-([\w+-]+)/.exec(className ?? "");
  return m ? (ALIASES[m[1].toLowerCase()] ?? null) : null;
}

export interface CellResult {
  ok: boolean;
  output: string;
  error?: string;
  ms: number;
}

export const MAX_OUTPUT = 20_000;

export function clampOutput(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…` : s;
}

/** Display a value the way a console would, without throwing on cycles or exotic objects. */
export function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "symbol") return v.toString();
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      v,
      (_k, x) => {
        if (typeof x === "bigint") return `${x}n`;
        if (x instanceof Map) return Object.fromEntries(x);
        if (x instanceof Set) return [...x];
        if (typeof x === "object" && x !== null) {
          if (seen.has(x)) return "[Circular]";
          seen.add(x);
        }
        return x;
      },
      Array.isArray(v) || (typeof v === "object" && v !== null && Object.keys(v).length <= 4) ? undefined : 2,
    ) ?? String(v);
  } catch {
    return String(v);
  }
}
