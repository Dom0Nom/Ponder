/**
 * Machine-translates the UI: src/locales/en.json → src/locales/<code>.json, with a shared glossary
 * per language, context per key, placeholder and plural checks, and a back-translation pass that
 * flags meaning drift on a sample and re-translates the flagged keys.
 *
 *   OPENROUTER_API_KEY=… bun scripts/translate.ts [--langs de,fr] [--model ID] [--check-model ID] [--sample N] [--force]
 *
 * Only keys that are missing or whose English changed since the last run are sent (hashes in
 * src/locales/meta/<code>.json). Glossaries live in src/locales/glossary/<code>.json and can be edited
 * by hand; a hand edit is kept. Never translates "Ponder".
 */
import { generateText } from "ai";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { liveModel } from "./lib/liveModel";
import { extractJson } from "../src/lib/chat/json";

if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required");
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

export const LANGUAGES: Record<string, string> = {
  "zh-Hans": "Chinese (Simplified)",
  "zh-Hant": "Chinese (Traditional)",
  hi: "Hindi",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
  bn: "Bengali",
  "pt-BR": "Portuguese (Brazil)",
  ru: "Russian",
  ur: "Urdu",
  id: "Indonesian",
  de: "German",
  ja: "Japanese",
  tr: "Turkish",
  ko: "Korean",
  vi: "Vietnamese",
  it: "Italian",
  pl: "Polish",
  fa: "Persian",
};

const TERMS = [
  ["Ponder", "the app's name; never translate"],
  ["space", "a learner's subject area holding sources, chats and notes (like a notebook)"],
  ["source", "a document the learner added (PDF, web page, video transcript)"],
  ["Studio", "the panel with study tools and generated outputs"],
  ["flashcard", "spaced-repetition card"],
  ["Next", "the button that picks what to study now"],
  ["focus session", "a timed study session with breaks"],
  ["break", "rest period in a focus session"],
  ["practice", "solving generated problems"],
  ["practice exam", "a timed mock exam"],
  ["worksheet", "a printable/fillable set of tasks"],
  ["mistake notebook", "list of the learner's wrong answers to retest"],
  ["review", "spaced-repetition review of due cards"],
  ["study buddy", "the assistant's short check-ins during a session"],
  ["deep research", "finding new sources on the web"],
  ["Low energy", "a gentle review-only session mode"],
  ["Hyperfocus guard", "reminder after long uninterrupted work"],
  ["micro-steps", "tiny first steps to start a task"],
  ["search model", "the local model that indexes sources for search"],
  ["chat", "a conversation with the tutor"],
  ["thread", "one chat conversation"],
  ["citation", "numbered link from an answer to a source passage"],
  ["mastery", "a topic counts as learned after a delayed check"],
  ["skill graph", "topics and their prerequisites"],
];

type Value = string | Record<string, string>;
type Flat = Record<string, Value>;

const read = <T>(f: string, d: T): T => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : d);
const write = (f: string, v: unknown) => writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
const hash = (v: Value) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 10);
const placeholders = (v: Value) =>
  (typeof v === "string" ? [v] : Object.values(v))
    .flatMap((s) => [...s.matchAll(/\{(\d+)(?:,\s*\w+)?\}/g)].map((m) => m[0]))
    .sort();

export function categories(code: string): string[] {
  return new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[];
}

/** Problems with a translated value, or null when it's usable. */
export function problem(en: Value, tr: unknown, code: string): string | null {
  if (typeof en === "string") {
    if (typeof tr !== "string" || !tr.trim()) return "missing";
    const a = new Set(placeholders(en));
    const b = new Set(placeholders(tr));
    if ([...a].some((p) => !b.has(p)) || [...b].some((p) => !a.has(p))) return `placeholders must be ${[...a].join(" ") || "none"}`;
    if (en.includes("Ponder") && !tr.includes("Ponder")) return 'keep "Ponder"';
    return null;
  }
  if (!tr || typeof tr !== "object") return `plural object with ${categories(code).join("/")}`;
  const need = categories(code);
  const t = tr as Record<string, unknown>;
  const missing = need.filter((c) => typeof t[c] !== "string" || !(t[c] as string).trim());
  if (missing.length) return `plural forms missing: ${missing.join(", ")}`;
  const want = new Set(placeholders(en));
  for (const c of need) {
    const got = new Set(placeholders(t[c] as string));
    // a form may drop {0} ("one" in some languages says it in words); it may not invent one
    if ([...got].some((p) => !want.has(p))) return `placeholders must be ${[...want].join(" ")}`;
  }
  return null;
}

/** Screen and purpose for a key, from its path; tight UI spots get a length limit. */
function keyContext(key: string, en: Value): string {
  const parts = key.split(".");
  const screen = parts[0];
  const name = parts.slice(1).join(".");
  const text = typeof en === "string" ? en : (en.other ?? Object.values(en)[0]);
  const tight = /button|label|tab|title|short|chip|menu|action|placeholder|^common\.|^shell\./i.test(key) && text.length <= 30;
  return `${screen} / ${name}${tight ? ` (UI label: keep it short, ≤ ${Math.max(text.length + 6, Math.ceil(text.length * 1.4))} characters if possible)` : ""}`;
}

async function glossary(code: string, model: ReturnType<typeof liveModel>): Promise<Record<string, string>> {
  const file = `src/locales/glossary/${code}.json`;
  const have = read<Record<string, string>>(file, {});
  const missing = TERMS.filter(([t]) => !have[t]);
  if (!missing.length) return have;
  const r = await generateText({
    model: model.model,
    ...model.options({ thinking: false }),
    temperature: 0,
    system: "You localize software UI. Reply with JSON only.",
    prompt: `Give the standard, natural ${LANGUAGES[code]} term for each concept in a study app's interface, the way a popular learning app in that language would say it. Keep "Ponder" as is. Return {"term": "translation"}.\n\n${missing.map(([t, d]) => `- ${t}: ${d}`).join("\n")}`,
  });
  const got = extractJson<Record<string, string>>(r.text) ?? {};
  const out = { ...got, ...have, Ponder: "Ponder" };
  mkdirSync("src/locales/glossary", { recursive: true });
  write(file, out);
  return out;
}

async function translateBatch(code: string, batch: [string, Value][], gloss: Record<string, string>, model: ReturnType<typeof liveModel>, notes: Record<string, string> = {}): Promise<Flat> {
  const cats = categories(code);
  const items = batch.map(([k, v]) => ({ key: k, context: keyContext(k, v), ...(notes[k] ? { fix: notes[k] } : {}), en: v }));
  const r = await generateText({
    model: model.model,
    ...model.options({ thinking: false }),
    temperature: 0.2,
    maxOutputTokens: 16_000,
    system: `You translate the UI of Ponder, a study app, from English into ${LANGUAGES[code]}. Reply with JSON only.`,
    prompt: [
      `Translate each "en" value into ${LANGUAGES[code]}. Rules:`,
      "- Natural, friendly UI language; short and plain; same register throughout (informal address where the language's apps usually use it, e.g. German \"du\").",
      "- Keep placeholders like {0}, {1}, {0, number}, {0, percent} exactly, moved to where the grammar needs them.",
      `- Values that are objects are plural forms: return an object with exactly these keys: ${cats.join(", ")}.`,
      "- Keep Markdown, keyboard keys (⌘K, Esc, Enter), units, symbols and brand names (Ponder, OpenRouter, ChatGPT, Spotify…) unchanged.",
      '- Respect length notes in "context". "fix" says what was wrong with an earlier attempt.',
      `- Use this glossary consistently:\n${Object.entries(gloss)
        .map(([a, b]) => `  ${a} → ${b}`)
        .join("\n")}`,
      'Return {"key": translation} for every key.',
      "",
      JSON.stringify(items),
    ].join("\n"),
  });
  return extractJson<Flat>(r.text) ?? {};
}

async function drift(code: string, pairs: [string, Value, Value][], checker: ReturnType<typeof liveModel>): Promise<Record<string, string>> {
  const r = await generateText({
    model: checker.model,
    ...checker.options({ thinking: false }),
    temperature: 0,
    maxOutputTokens: 8_000,
    system: "You review UI translations. Reply with JSON only.",
    prompt: [
      `For each item, translate the ${LANGUAGES[code]} text back into English yourself, then compare it with the original English. Flag only real meaning drift (wrong meaning, missing or added information, wrong action, a button that would mislead), not style.`,
      'Return {"key": "what is wrong, in one short sentence"} for flagged items only; {} if all are fine.',
      JSON.stringify(pairs.map(([key, en, tr]) => ({ key, en, translation: tr }))),
    ].join("\n"),
  });
  return extractJson<Record<string, string>>(r.text) ?? {};
}

const en = read<Flat>("src/locales/en.json", {});
if (!Object.keys(en).length) throw new Error("src/locales/en.json is empty; run `bun scripts/i18n.ts extract` first");
const langs = (flag("langs") ?? Object.keys(LANGUAGES).join(",")).split(",");
const model = liveModel(flag("model") ?? "deepseek/deepseek-v4.1-flash");
const checker = liveModel(flag("check-model") ?? "google/gemini-2.5-flash");
const sampleSize = Number(flag("sample") ?? 80);
const BATCH = 60;
mkdirSync("src/locales/meta", { recursive: true });

for (const code of langs) {
  if (!LANGUAGES[code]) throw new Error(`unknown language ${code}`);
  const file = `src/locales/${code}.json`;
  const metaFile = `src/locales/meta/${code}.json`;
  const out = read<Flat>(file, {});
  const meta = read<Record<string, string>>(metaFile, {});
  const gloss = await glossary(code, model);
  const todo = Object.entries(en).filter(([k, v]) => args.includes("--force") || out[k] == null || meta[k] !== hash(v) || problem(v, out[k], code));
  for (const k of Object.keys(out)) if (!(k in en)) delete out[k];
  console.log(`${code}: ${todo.length} of ${Object.keys(en).length} keys to translate`);
  let failed: [string, Value][] = [];
  const notes: Record<string, string> = {};
  for (let pass = 0; pass < 3; pass++) {
    const list = pass === 0 ? todo : failed;
    failed = [];
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const got = await translateBatch(code, batch, gloss, model, notes).catch((e) => {
        console.log(`  batch failed: ${(e as Error).message}`);
        return {} as Flat;
      });
      for (const [k, v] of batch) {
        const p = problem(v, got[k], code);
        if (p) {
          notes[k] = p;
          failed.push([k, v]);
        } else {
          out[k] = got[k];
          meta[k] = hash(v);
        }
      }
      write(file, out);
      write(metaFile, meta);
    }
    if (!failed.length) break;
    console.log(`  pass ${pass + 1}: ${failed.length} keys to retry`);
  }
  if (failed.length) console.log(`  still failing: ${failed.map(([k]) => k).join(", ")}`);

  // back-translation check on a sample (most visible keys first), re-translate what drifted
  const visible = (k: string) => (/^(common|shell|home|chat|sources|studio|settings|focus|onboarding)\./.test(k) ? 0 : 1);
  const sample = Object.keys(en)
    .filter((k) => out[k] != null)
    .sort((a, b) => visible(a) - visible(b) || a.localeCompare(b))
    .slice(0, sampleSize);
  const flagged: Record<string, string> = {};
  for (let i = 0; i < sample.length; i += 40) {
    const part = sample.slice(i, i + 40).map((k) => [k, en[k], out[k]] as [string, Value, Value]);
    Object.assign(flagged, await drift(code, part, checker).catch(() => ({})));
  }
  const keys = Object.keys(flagged).filter((k) => k in en);
  if (keys.length) {
    console.log(`  drift flagged ${keys.length}: ${keys.join(", ")}`);
    const got = await translateBatch(
      code,
      keys.map((k) => [k, en[k]]),
      gloss,
      model,
      Object.fromEntries(keys.map((k) => [k, `Earlier translation "${JSON.stringify(out[k])}" was flagged: ${flagged[k]}`])),
    );
    for (const k of keys) if (!problem(en[k], got[k], code)) out[k] = got[k];
    write(file, out);
  }
  const report = read<Record<string, unknown>>("src/locales/meta/report.json", {});
  report[code] = { at: new Date().toISOString(), keys: Object.keys(out).length, of: Object.keys(en).length, failing: failed.map(([k]) => k), driftChecked: sample.length, driftFixed: keys.length };
  write("src/locales/meta/report.json", report);
}
process.exit(0);
