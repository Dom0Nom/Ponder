/**
 * Message file tooling.
 *   bun scripts/i18n.ts extract   writes src/locales/en.json from src/locales/en.ts
 *   bun scripts/i18n.ts check     validates every locale file and the literal-text rules
 *
 * "Not yet translated" means the key is absent from <code>.json; the app then shows English.
 * That is a warning (and counts against the coverage percentage), never an error.
 * Errors are structure problems: unknown keys, wrong placeholders, wrong plural categories.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import ts from "typescript";
import { en } from "../src/locales/en";
import { LOCALES } from "../src/lib/i18n/locales";
import { PLACEHOLDER, flatten, type MessageValue } from "../src/lib/i18n/message";

const ROOT = join(import.meta.dirname, "..");
const LOCALE_DIR = join(ROOT, "src/locales");
const SRC = join(ROOT, "src");

export interface Report {
  errors: string[];
  warnings: string[];
  coverage: Record<string, number>;
}

export function englishMessages(): Record<string, MessageValue> {
  return Object.fromEntries(flatten(en).map((e) => [e.key, e.value]));
}

const render = (messages: object) => `${JSON.stringify(messages, null, 2)}\n`;

export function extract(): string {
  const file = join(LOCALE_DIR, "en.json");
  writeFileSync(file, render(englishMessages()));
  return file;
}

const indices = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function categories(code: string): string[] {
  return new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[];
}

export function checkLocaleFile(code: string, messages: Record<string, MessageValue>, source: Record<string, MessageValue>, report: Report) {
  const err = (key: string, msg: string) => report.errors.push(`${code}: ${key}: ${msg}`);
  const cats = categories(code);
  let translated = 0;
  for (const [key, value] of Object.entries(messages)) {
    const base = source[key];
    if (base === undefined) {
      err(key, "unknown key (not in en.json)");
      continue;
    }
    translated++;
    if (typeof base === "string") {
      if (typeof value !== "string") {
        err(key, "must be a string");
        continue;
      }
      if (!same(indices(value), indices(base))) err(key, `placeholders {${indices(value)}} do not match English {${indices(base)}}`);
      continue;
    }
    if (typeof value === "string") {
      if (cats.length > 1) err(key, `plural needs the categories ${cats.join(", ")}`);
      else if (!same(indices(value), indices(base.other))) err(key, "placeholders do not match English");
      continue;
    }
    if (!value || typeof value !== "object" || typeof value.other !== "string") {
      err(key, "plural needs an 'other' form");
      continue;
    }
    const want = indices(base.other);
    for (const [cat, text] of Object.entries(value)) {
      if (!cats.includes(cat)) err(key, `'${cat}' is not a plural category of ${code} (${cats.join(", ")})`);
      if (typeof text !== "string") {
        err(key, `'${cat}' must be a string`);
        continue;
      }
      const have = indices(text);
      const ok = cat === "other" ? same(have, want) : have.every((i) => want.includes(i));
      if (!ok) err(key, `'${cat}' placeholders {${have}} do not match English {${want}}`);
    }
    for (const cat of cats) if (!(cat in value)) err(key, `missing plural category '${cat}'`);
  }
  const total = Object.keys(source).length;
  report.coverage[code] = total ? translated / total : 1;
  const missing = total - translated;
  if (missing > 0) report.warnings.push(`${code}: ${missing} of ${total} keys not translated yet (shows English)`);
}

// ---------- literal text in JSX ----------

const LETTERS = /\p{L}/u;
const TEXT_PROPS = new Set(["aria-label", "placeholder", "title", "alt", "label"]);
const BRANDS = new Set(["Ponder", "OpenRouter", "OpenAI", "Anthropic", "Google", "Gemini", "ElevenLabs", "Ollama", "LM Studio", "PDF", "EPUB", "DOCX", "Markdown", "YouTube", "Spotify", "Dropbox", "Esc", "Enter", "Tab", "Shift", "Ctrl", "Alt", "Cmd", "Del", "Kbd"]);
// URLs and example tokens such as "abc123xyz" or "GOCSPX-…" in placeholders
const TECHNICAL = /^(https?:\/\/\S+|[^\s]*[\d…\-_:/.@][^\s]*)$/u;
const SKIP_DIRS = ["src/features/calculator/", "src/test/"];

export interface Literal {
  file: string;
  line: number;
  text: string;
  where: string;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function stringsIn(node: ts.Expression, out: { text: string; pos: number }[]) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push({ text: node.text, pos: node.getStart() });
  else if (ts.isTemplateExpression(node)) {
    out.push({ text: node.head.text, pos: node.getStart() });
    for (const span of node.templateSpans) out.push({ text: span.literal.text, pos: span.literal.getStart() });
  } else if (ts.isParenthesizedExpression(node)) stringsIn(node.expression, out);
  else if (ts.isConditionalExpression(node)) {
    stringsIn(node.whenTrue, out);
    stringsIn(node.whenFalse, out);
  } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) {
    stringsIn(node.left, out);
    stringsIn(node.right, out);
  }
}

export function findLiterals(): Literal[] {
  const found: Literal[] = [];
  for (const path of walk(SRC)) {
    const rel = relative(ROOT, path);
    if (!rel.endsWith(".tsx") || rel.endsWith(".test.tsx") || SKIP_DIRS.some((d) => rel.startsWith(d))) continue;
    const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const add = (text: string, pos: number, where: string) => {
      const t = text.replace(/&[a-z]+;|&#\d+;/gi, " ").trim();
      if (!LETTERS.test(t) || BRANDS.has(t) || TECHNICAL.test(t)) return;
      found.push({ file: rel, line: sf.getLineAndCharacterOfPosition(pos).line + 1, text: t, where });
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) add(node.text, node.getStart(), "text");
      else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
        const lits: { text: string; pos: number }[] = [];
        stringsIn(node.expression, lits);
        for (const l of lits) add(l.text, l.pos, "expression");
      } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && TEXT_PROPS.has(node.name.text) && node.initializer) {
        const lits: { text: string; pos: number }[] = [];
        if (ts.isStringLiteral(node.initializer)) lits.push({ text: node.initializer.text, pos: node.initializer.getStart() });
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) stringsIn(node.initializer.expression, lits);
        for (const l of lits) add(l.text, l.pos, node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

export function readLocale(code: string): Record<string, MessageValue> {
  return JSON.parse(readFileSync(join(LOCALE_DIR, `${code}.json`), "utf8"));
}

export function runChecks(): Report & { literals: Literal[] } {
  const report: Report & { literals: Literal[] } = { errors: [], warnings: [], coverage: {}, literals: [] };
  const source = englishMessages();
  const enFile = join(LOCALE_DIR, "en.json");
  if (!existsSync(enFile) || readFileSync(enFile, "utf8") !== render(source)) report.errors.push("en.json is out of sync with en.ts: run `bun scripts/i18n.ts extract`");
  const known = new Set(LOCALES.map((l) => l.code));
  for (const file of readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json") && f !== "en.json")) {
    const code = basename(file, ".json");
    if (!known.has(code)) {
      report.errors.push(`${file}: not a supported language code`);
      continue;
    }
    try {
      checkLocaleFile(code, readLocale(code), source, report);
    } catch (e) {
      report.errors.push(`${file}: ${(e as Error).message}`);
    }
  }
  for (const l of LOCALES) if (l.code !== "en" && !(l.code in report.coverage)) report.coverage[l.code] = 0;
  report.literals = findLiterals();
  for (const l of report.literals) report.errors.push(`${l.file}:${l.line}: literal ${l.where} "${l.text.slice(0, 60)}" must come from s`);
  return report;
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "extract") {
    console.log(`wrote ${relative(ROOT, extract())}`);
    return;
  }
  if (cmd === "check") {
    const r = runChecks();
    for (const w of r.warnings) console.warn(`warning: ${w}`);
    for (const e of r.errors) console.error(`error: ${e}`);
    const cov = Object.entries(r.coverage)
      .map(([c, v]) => `${c} ${Math.round(v * 100)}%`)
      .join(", ");
    console.log(`coverage: ${cov}`);
    if (r.errors.length) process.exit(1);
    console.log("i18n check passed");
    return;
  }
  console.error("usage: bun scripts/i18n.ts extract|check");
  process.exit(2);
}

if (process.argv[1]?.endsWith("scripts/i18n.ts")) main();
