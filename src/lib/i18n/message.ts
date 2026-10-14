export type FormatKind = "number" | "percent" | "minutes" | "seconds";

export class Msg<A extends unknown[] = unknown[]> {
  declare readonly _args: A;
  constructor(readonly template: string) {}
}

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export class Plural<A extends unknown[] = unknown[]> {
  declare readonly _args: A;
  constructor(
    readonly forms: PluralForms,
    readonly index: number,
  ) {}
}

export class Fixed<V = unknown> {
  constructor(readonly value: V) {}
}

export const msg = <A extends unknown[]>(template: string) => new Msg<A>(template);
export const plural = <A extends unknown[]>(forms: PluralForms, index = 0) => new Plural<A>(forms, index);
export const fixed = <V>(value: V) => new Fixed<V>(value);

export type Resolve<T> =
  T extends Msg<infer A>
    ? (...args: A) => string
    : T extends Plural<infer A>
      ? (...args: A) => string
      : T extends Fixed<infer V>
        ? V
        : T extends string
          ? string
          : T extends readonly unknown[]
            ? { -readonly [K in keyof T]: Resolve<T[K]> }
            : T extends object
              ? { [K in keyof T]: Resolve<T[K]> }
              : T;

export const PLACEHOLDER = /\{(\d+)(?:\s*,\s*(number|percent|minutes|seconds))?\s*\}/g;

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, kind: FormatKind): Intl.NumberFormat {
  const key = `${locale}|${kind}`;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.NumberFormatOptions =
      kind === "percent"
        ? { style: "percent" }
        : kind === "minutes"
          ? { style: "unit", unit: "minute", unitDisplay: "short" }
          : kind === "seconds"
            ? { style: "unit", unit: "second", unitDisplay: "short" }
            : {};
    f = new Intl.NumberFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

export function formatValue(locale: string, value: unknown, kind?: FormatKind): string {
  if (typeof value === "number") return numberFormat(locale, kind ?? "number").format(value);
  return String(value ?? "");
}

type Part = string | { index: number; kind?: FormatKind };

function parse(template: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (m.index > last) parts.push(template.slice(last, m.index));
    parts.push({ index: Number(m[1]), kind: m[2] as FormatKind | undefined });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts;
}

function render(parts: Part[], locale: string, args: unknown[]): string {
  let out = "";
  for (const p of parts) out += typeof p === "string" ? p : formatValue(locale, args[p.index], p.kind);
  return out;
}

export function compileMessage(template: string, locale: string): (...args: unknown[]) => string {
  const parts = parse(template);
  return (...args) => render(parts, locale, args);
}

export function compilePlural(forms: PluralForms, index: number, locale: string): (...args: unknown[]) => string {
  const rules = new Intl.PluralRules(locale);
  const compiled = new Map<string, Part[]>();
  for (const [cat, text] of Object.entries(forms)) if (typeof text === "string") compiled.set(cat, parse(text));
  const other = compiled.get("other") ?? [];
  return (...args) => {
    const n = Number(args[index]);
    return render(compiled.get(rules.select(Number.isFinite(n) ? n : 0)) ?? other, locale, args);
  };
}

export type MessageValue = string | Record<string, string>;
export type Messages = Record<string, MessageValue>;

/** Builds or updates `dst` in place from the source tree; `messages` override source values by dotted key. */
export function apply(src: unknown, dst: Record<string, unknown> | unknown[], messages: Messages, locale: string, path = "") {
  const d = dst as Record<string, unknown>;
  for (const key of Object.keys(src as object)) {
    const v = (src as Record<string, unknown>)[key];
    const p = path ? `${path}.${key}` : key;
    const o = messages[p];
    if (v instanceof Msg) d[key] = compileMessage(typeof o === "string" ? o : v.template, locale);
    else if (v instanceof Plural) {
      const forms = typeof o === "string" ? { other: o } : o && typeof o === "object" && typeof o.other === "string" ? (o as PluralForms) : v.forms;
      d[key] = compilePlural(forms, v.index, locale);
    } else if (v instanceof Fixed) d[key] = v.value;
    else if (typeof v === "string") d[key] = typeof o === "string" ? o : v;
    else if (v && typeof v === "object") {
      if (!d[key]) d[key] = Array.isArray(v) ? [] : {};
      apply(v, d[key] as Record<string, unknown>, messages, locale, p);
    } else d[key] = v;
  }
}

export interface FlatEntry {
  key: string;
  value: MessageValue;
  kind: "string" | "msg" | "plural";
}

export function flatten(src: unknown, path = "", out: FlatEntry[] = []): FlatEntry[] {
  for (const key of Object.keys(src as object)) {
    const v = (src as Record<string, unknown>)[key];
    const p = path ? `${path}.${key}` : key;
    if (v instanceof Msg) out.push({ key: p, value: v.template, kind: "msg" });
    else if (v instanceof Plural) out.push({ key: p, value: { ...v.forms } as Record<string, string>, kind: "plural" });
    else if (v instanceof Fixed) continue;
    else if (typeof v === "string") out.push({ key: p, value: v, kind: "string" });
    else if (v && typeof v === "object") flatten(v, p, out);
  }
  return out;
}
