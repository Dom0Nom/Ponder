/**
 * Prompt eval: runs every app prompt on fixed EN/DE inputs (GED-flavoured), applies deterministic
 * checks and an LLM judge, and writes a JSON report.
 *
 *   OPENROUTER_API_KEY=… bun scripts/prompt-eval.ts [--root DIR] [--only a,b] [--samples N] [--out FILE]
 *   bun scripts/prompt-eval.ts --compare old.json new.json
 *
 * --root points at another checkout (e.g. a worktree of the baseline commit) so old and new prompts
 * run through the same cases. Generator: deepseek/deepseek-v4.1-flash, judge: anthropic/claude-haiku-4.5.
 */
import { generateText } from "ai";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { liveModel } from "./lib/liveModel";
import { createLanguageModel } from "../src/lib/providers/model";
import type { ResolvedModel } from "../src/lib/chat/llm";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------- compare mode ----------
if (args[0] === "--compare") {
  const [a, b] = [args[1], args[2]].map((f) => JSON.parse(readFileSync(f, "utf8")) as Report);
  const ids = [...new Set([...Object.keys(a.summary), ...Object.keys(b.summary)])];
  console.log(`| prompt | checks old → new | judge old → new | Δ judge |`);
  console.log(`|---|---|---|---|`);
  for (const id of ids) {
    const x = a.summary[id];
    const y = b.summary[id];
    const f = (s?: Summary) => (s ? `${(s.checkRate * 100).toFixed(0)}%` : "–");
    const j = (s?: Summary) => (s ? s.judge.toFixed(2) : "–");
    const d = x && y ? (y.judge - x.judge).toFixed(2) : "";
    console.log(`| ${id} | ${f(x)} → ${f(y)} | ${j(x)} → ${j(y)} | ${d} |`);
  }
  process.exit(0);
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Set OPENROUTER_API_KEY (the eval never falls back to a local model).");
  process.exit(1);
}

const root = resolve(flag("root") ?? ".");
const only = flag("only")?.split(",");
const samples = Number(flag("samples") ?? 1);
const out = flag("out") ?? `.native-bin/prompt-eval-${Date.now()}.json`;
const genModel = flag("model") ?? "deepseek/deepseek-v4.1-flash";
const judgeModel = flag("judge") ?? "anthropic/claude-haiku-4.5";
const lib = (p: string) => import(`${root}/src/lib/${p}`);

// ---------- recording model ----------
interface Call {
  prompt: string;
  output: string;
}
const store = new AsyncLocalStorage<Call[]>();
const cur = () => store.getStore() ?? [];

function recording(modelId: string): ResolvedModel {
  const base = liveModel(modelId);
  const key = process.env.OPENROUTER_API_KEY!;
  const fetchRec: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${key}`);
    const res = await fetch(input, { ...init, headers });
    try {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const prompt = (body.messages ?? [])
        .map((m: { role: string; content: unknown }) => `<<${m.role}>>\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
        .join("\n\n");
      const clone = res.clone();
      const j = await clone.json();
      store.getStore()?.push({ prompt, output: j?.choices?.[0]?.message?.content ?? "" });
    } catch {
      // streaming or non-JSON response: not recorded
    }
    return res;
  };
  return { ...base, model: createLanguageModel(base.provider, modelId, { fetch: fetchRec as typeof fetch }) };
}

const gen = recording(genModel);

// ---------- deterministic helpers ----------
const DE = /\b(und|der|die|das|ist|nicht|ein|eine|mit|für|auf|du|ich|zu|wie|was|den|dem|sich|auch|oder|wenn|bei)\b/gi;
const EN = /\b(the|and|is|are|not|a|an|with|for|on|you|to|how|what|of|in|this|that|it|or|if|at)\b/gi;
export function lang(text: string): "de" | "en" | "?" {
  const t = text.replace(/\$[^$]*\$/g, " ").replace(/`[^`]*`/g, " ");
  const de = (t.match(DE) ?? []).length + (/[äöüß]/i.test(t) ? 3 : 0);
  const en = (t.match(EN) ?? []).length;
  if (de + en < 3) return "?";
  return de > en ? "de" : "en";
}
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const PRAISE = /\b(great question|excellent question|good question|what a great|amazing|fantastic|super frage|tolle frage|gute frage|ausgezeichnet)\b/i;
const VISIBLE_REASONING = /<think>|<reasoning>|^\s*(Reasoning|Thinking):/im;
const sentenceCount = (t: string) => (t.match(/(?<!\b\d{1,4}|\b[A-Za-z]|\bvs|\bca|\bz\.B|\bbzw)[.!?](\s|$)/g) ?? []).length;
const questionMarks = (t: string) => (t.replace(/\$[^$]*\$/g, "").match(/\?/g) ?? []).length;

interface Check {
  name: string;
  pass: boolean;
  note?: string;
}
const check = (name: string, pass: boolean, note?: string): Check => ({ name, pass, note });

// ---------- tasks ----------
interface CaseResult {
  checks: Check[];
  /** what the judge sees as the model's output */
  output: string;
  /** extra context for the judge: expected behaviour */
  expect: string;
}
interface Task {
  id: string;
  /** what this prompt is for, for the judge */
  purpose: string;
  /** rubric dimensions that apply */
  dims: Dim[];
  cases: { name: string; run: () => Promise<CaseResult> }[];
}
type Dim = "grounding" | "withholding" | "diagnosis" | "guidance" | "calibration" | "tone" | "format";

const DIM_TEXT: Record<Dim, string> = {
  grounding: "Grounding: 1 = invents facts, quotes or citation numbers; 3 = mostly faithful with one loose claim; 5 = every claim supported by the given material, outside knowledge clearly marked.",
  withholding: "Withholding: 1 = gives away the final answer when it should not; 3 = gives a near-complete step; 5 = guides without revealing what the learner should find (score 5 if revealing is intended here).",
  diagnosis: "Diagnosis: 1 = misses or misnames the mistake; 3 = finds that something is wrong but not where; 5 = names exactly what and where went wrong.",
  guidance: "Guidance: 1 = vague or wrong; 3 = correct but the learner isn't sure what to do next; 5 = correct, relevant and the learner knows exactly the next move.",
  calibration: "Calibration: 1 = ignores the constraints in the instructions (length, level, energy, count, mode); 3 = follows most; 5 = follows all of them.",
  tone: "Tone: 1 = condescending, effusive praise or filler; 3 = fine with some fluff; 5 = warm, plain, direct, no inflated praise.",
  format: "Language and format: 1 = wrong language or broken required format; 3 = minor format slips; 5 = right language, exactly the required format.",
};

const passages = {
  photosynthesis: [
    { n: 1, sourceTitle: "Biology notes", page: 12, text: "Photosynthesis takes place in the chloroplasts. The light-dependent reactions happen in the thylakoid membranes and produce ATP and NADPH. Oxygen is released as a by-product from splitting water." },
    { n: 2, sourceTitle: "Biology notes", page: 13, text: "The Calvin cycle runs in the stroma. It uses ATP and NADPH to fix carbon dioxide into sugar. The enzyme RuBisCO catalyzes the first step of carbon fixation." },
  ],
  gedMath: [
    { n: 1, sourceTitle: "GED Math Formula Sheet", page: 1, text: "Area of a trapezoid: A = ½h(b₁ + b₂). Slope of a line: m = (y₂ − y₁)/(x₂ − x₁). Slope-intercept form: y = mx + b. Pythagorean theorem: a² + b² = c²." },
  ],
  verfassung: [
    { n: 1, sourceTitle: "Politik-Skript", page: 4, text: "Das Grundgesetz trat am 23. Mai 1949 in Kraft. Der Bundestag wird alle vier Jahre gewählt. Der Bundesrat vertritt die Länder bei der Gesetzgebung des Bundes." },
  ],
  civics: [
    { n: 1, sourceTitle: "GED Social Studies guide", page: 22, text: "The U.S. Constitution divides power among three branches. Congress makes laws, the President enforces them, and the courts interpret them. This system of checks and balances keeps any one branch from becoming too powerful." },
  ],
};

const focusState = (o: Partial<Record<string, unknown>> = {}) => ({
  sessionId: "s1",
  spaceId: "sp",
  technique: "pomodoro",
  goal: "Finish GED slope practice",
  phase: "work",
  block: 2,
  phaseStartedAt: 0,
  phaseDurationMs: 25 * 60000,
  elapsedMs: 21 * 60000,
  remainingMs: 4 * 60000,
  paused: false,
  pauseReason: null,
  pauseCount: 1,
  needAppCount: 0,
  totalFocusMs: 46 * 60000,
  totalBreakMs: 5 * 60000,
  checkInMins: 10,
  now: Date.UTC(2026, 9, 12, 14, 0),
  ...o,
});

async function tutorTurn(input: {
  style: "direct" | "socratic" | "mixed";
  q: string;
  passages: { n: number; sourceTitle: string; page: number | null; text: string }[];
  strict?: boolean;
  sourceCount?: number;
  focus?: ReturnType<typeof focusState> | null;
  history?: { role: "user" | "assistant"; content: string }[];
  memory?: string[];
  voice?: boolean;
}) {
  const { buildSystemPrompt } = await lib("chat/context.ts");
  const system: string = buildSystemPrompt({
    space: { name: "GED prep", strictGrounding: !!input.strict },
    tutorStyle: input.style,
    passages: input.passages,
    focus: input.focus ?? null,
    now: Date.UTC(2026, 9, 12, 14, 0),
    sourceCount: input.sourceCount ?? input.passages.length,
    memory: input.memory,
    voice: input.voice,
  });
  const r = await generateText({
    model: gen.model,
    system,
    messages: [...(input.history ?? []), { role: "user", content: input.q }],
    ...gen.options({ thinking: false }),
  });
  return r.text;
}

function tutorChecks(text: string, o: { lang: "de" | "en"; maxCite: number; leak?: RegExp; strict?: boolean; maxQuestions?: number }) {
  const cites = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const c = [
    check("language", lang(text.replace(/\{\{[^}]*\}\}/g, "")) === o.lang, lang(text)),
    check("valid citations", cites.every((n) => n >= 1 && n <= o.maxCite), cites.join(",")),
    check("no inflated praise", !PRAISE.test(text)),
    check("no visible reasoning", !VISIBLE_REASONING.test(text)),
  ];
  if (o.leak) c.push(check("answer withheld", !o.leak.test(text.replace(/\{\{followup:[^}]*\}\}/g, ""))));
  if (o.strict) c.push(check("strict: no general markers", !text.includes("{{general}}")));
  if (o.maxQuestions != null) {
    const body = text.replace(/\{\{followup:[^}]*\}\}/g, "");
    c.push(check(`≤${o.maxQuestions} questions`, questionMarks(body) <= o.maxQuestions, String(questionMarks(body))));
  }
  return c;
}

const tutor: Task = {
  id: "tutor-system",
  purpose: "Main study-tutor reply inside a learning app, grounded in numbered passages from the learner's sources, following the selected tutor style (direct, Socratic, mixed).",
  dims: ["grounding", "withholding", "guidance", "calibration", "tone", "format"],
  cases: [
    {
      name: "direct EN grounded",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "Where does the Calvin cycle happen and what does it need?", passages: passages.photosynthesis });
        return { output: t, expect: "Direct answer: stroma, uses ATP and NADPH, cites [2].", checks: [...tutorChecks(t, { lang: "en", maxCite: 2 }), check("cites [2]", t.includes("[2]"))] };
      },
    },
    {
      name: "socratic EN math",
      run: async () => {
        const t = await tutorTurn({ style: "socratic", q: "What's the slope of the line through (2, 3) and (6, 11)?", passages: passages.gedMath });
        return { output: t, expect: "Socratic: must NOT state that the slope is 2. One guiding question, may point at the slope formula [1].", checks: tutorChecks(t, { lang: "en", maxCite: 1, leak: /\b(slope|m)\s*(is|=|equals)\s*2\b|=\s*2\s*$|\b8\s*\/\s*4\s*=\s*2/im, maxQuestions: 2 }) };
      },
    },
    {
      name: "socratic EN pushback",
      run: async () => {
        const t = await tutorTurn({
          style: "socratic",
          q: "just tell me the answer",
          passages: passages.gedMath,
          history: [
            { role: "user", content: "Find the hypotenuse of a right triangle with legs 6 and 8." },
            { role: "assistant", content: "Which formula from your sheet links the two legs and the hypotenuse?" },
            { role: "user", content: "a^2+b^2=c^2?" },
            { role: "assistant", content: "Yes. What do you get when you put 6 and 8 into it?" },
          ],
        });
        return { output: t, expect: "Socratic after the learner asks directly. Allowed to move one rung (show 36 + 64 = c²) but ideally still lets the learner take the last step, or gives the answer only with the reasoning. Not lecturing.", checks: tutorChecks(t, { lang: "en", maxCite: 1, maxQuestions: 2 }) };
      },
    },
    {
      name: "socratic DE",
      run: async () => {
        const t = await tutorTurn({ style: "socratic", q: "Wann ist das Grundgesetz in Kraft getreten?", passages: passages.verfassung });
        return { output: t, expect: "German, Socratic: guide toward the date without stating 23. Mai 1949 outright, or (acceptable for pure recall) give a strong hint.", checks: tutorChecks(t, { lang: "de", maxCite: 1, maxQuestions: 2 }) };
      },
    },
    {
      name: "mixed DE stuck",
      run: async () => {
        const t = await tutorTurn({
          style: "mixed",
          q: "Ich versteh es immer noch nicht, erklär es mir bitte einfach.",
          passages: passages.verfassung,
          history: [
            { role: "user", content: "Was macht der Bundesrat?" },
            { role: "assistant", content: "Gute Frage zum Einstieg: Wen vertritt der Bundesrat deiner Meinung nach?" },
          ],
        });
        return { output: t, expect: "German, mixed style, learner is stuck and asks directly: now explain fully (Bundesrat vertritt die Länder bei der Bundesgesetzgebung) with citation [1].", checks: [...tutorChecks(t, { lang: "de", maxCite: 1 }), check("cites [1]", t.includes("[1]"))] };
      },
    },
    {
      name: "strict, nothing matched",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "What is the quadratic formula?", passages: [], strict: true, sourceCount: 3 });
        return { output: t, expect: "Strict grounding with no matching passage: must say the sources don't cover it and suggest a source to add. Must not give the formula from general knowledge.", checks: [...tutorChecks(t, { lang: "en", maxCite: 0, strict: true }), check("no formula given", !/b\s*\^?\s*2\s*-\s*4\s*a\s*c|b²\s*[-−]\s*4ac/i.test(t))] };
      },
    },
    {
      name: "general knowledge marked",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "Why does the Calvin cycle need light indirectly, and who discovered it?", passages: passages.photosynthesis });
        return { output: t, expect: "Uses passages for the light link ([1],[2]); the discoverer (Melvin Calvin) is not in the passages, so it must be wrapped in {{general}}…{{/general}}.", checks: [...tutorChecks(t, { lang: "en", maxCite: 2 }), check("general marked", /\{\{general\}\}[\s\S]*Calvin[\s\S]*\{\{\/general\}\}/.test(t))] };
      },
    },
    {
      name: "focus: 4 min to break",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "Explain checks and balances.", passages: passages.civics, focus: focusState() });
        return { output: t, expect: "4 minutes until the break: short answer that fits, cites [1].", checks: [...tutorChecks(t, { lang: "en", maxCite: 1 }), check("short (≤180 words)", words(t) <= 180, String(words(t)))] };
      },
    },
    {
      name: "low energy",
      run: async () => {
        const t = await tutorTurn({ style: "mixed", q: "can we start the next chapter on the Bill of Rights?", passages: passages.civics, focus: focusState({ energy: "low", goal: null }) });
        return { output: t, expect: "Low-energy review session: gently steer to reviewing instead of starting new material; short; one small next step.", checks: [...tutorChecks(t, { lang: "en", maxCite: 1 }), check("short (≤120 words)", words(t) <= 120, String(words(t)))] };
      },
    },
    {
      name: "no sources, EN, memory",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "how do I find the area of a trapezoid", passages: [], sourceCount: 0, memory: ["Prefers worked examples with real-world objects", "Studying for the GED math test in December"] });
        return { output: t, expect: "No sources: answer from general knowledge wrapped in {{general}} markers; uses a real-world worked example (memory); doesn't recite the memory.", checks: [...tutorChecks(t, { lang: "en", maxCite: 0 }), check("general marked", t.includes("{{general}}"))] };
      },
    },
  ],
};

function voiceChecks(text: string, o: { lang: "de" | "en"; maxCite: number }) {
  const body = text.replace(/\{\{[^}]*\}\}/g, "");
  return [
    ...tutorChecks(text, { lang: o.lang, maxCite: o.maxCite }),
    check("≤80 words", words(body) <= 80, String(words(body))),
    check("≤4 sentences", sentenceCount(body) <= 4, String(sentenceCount(body))),
    check("≤1 question", questionMarks(body) <= 1, String(questionMarks(body))),
    check("spoken text: no Markdown or LaTeX", !/[*#`|$\\^]|^\s*([-•]|\d+[.)])\s/m.test(body)),
    check("no follow-up markers", !text.includes("{{followup")),
  ];
}

const voiceTutor: Task = {
  id: "tutor-voice",
  purpose: "Main study-tutor reply in a spoken conversation: the learner talks, a speech engine reads the reply aloud. It must sound like a tutor talking, stay short, and still be grounded in the numbered passages.",
  dims: ["grounding", "guidance", "calibration", "tone", "format"],
  cases: [
    {
      name: "voice EN grounded",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "Where does the Calvin cycle happen and what does it need?", passages: passages.photosynthesis, voice: true });
        return { output: t, expect: "Short spoken answer: stroma, ATP and NADPH, cites [2] with the bracket after the sentence. Reads naturally aloud.", checks: [...voiceChecks(t, { lang: "en", maxCite: 2 }), check("cites [2]", t.includes("[2]"))] };
      },
    },
    {
      name: "voice DE grounded",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "Was macht der Bundesrat eigentlich?", passages: passages.verfassung, voice: true });
        return { output: t, expect: "Short spoken German answer: Bundesrat vertritt die Länder, cites [1].", checks: voiceChecks(t, { lang: "de", maxCite: 1 }) };
      },
    },
    {
      name: "voice math in words",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "How do I get the slope of a line from two points?", passages: passages.gedMath, voice: true });
        return { output: t, expect: "Spoken explanation of the slope formula with no symbols or LaTeX: says 'change in y over change in x' in words.", checks: voiceChecks(t, { lang: "en", maxCite: 1 }) };
      },
    },
    {
      name: "voice long request",
      run: async () => {
        const t = await tutorTurn({ style: "direct", q: "Explain the whole of photosynthesis to me step by step, every reaction.", passages: passages.photosynthesis, voice: true });
        return { output: t, expect: "Does not read out a long lecture: gives the first part within the limits and asks whether to go on.", checks: [...voiceChecks(t, { lang: "en", maxCite: 2 }), check("offers to continue", /\?\s*$/.test(body(t)))] };
      },
    },
    {
      name: "voice socratic",
      run: async () => {
        const t = await tutorTurn({ style: "socratic", q: "What's the slope of the line through two, three and six, eleven?", passages: passages.gedMath, voice: true });
        return { output: t, expect: "Socratic and spoken: one guiding question, does not state that the slope is 2.", checks: [...voiceChecks(t, { lang: "en", maxCite: 1 }), check("answer withheld", !/\b(slope|m)\s*(is|=|equals)\s*(2|two)\b/i.test(t))] };
      },
    },
  ],
};
const body = (t: string) => t.replace(/\{\{[^}]*\}\}/g, "").trim();

const buddyCtx = (o: Record<string, unknown> = {}) => ({ state: focusState(), previous: null, parking: [], needAppPauses: 0, ...o });

async function buddyTurn(kind: string, ctx: Record<string, unknown>, history: { role: "user" | "assistant"; content: string }[], langHint: "en" | "de") {
  const { buddyInstruction } = await lib("buddy/prompts.ts");
  const { buildSystemPrompt } = await lib("chat/context.ts");
  const instr: string = buddyInstruction(kind, ctx);
  const system: string = buildSystemPrompt({
    space: { name: langHint === "de" ? "Politik" : "GED prep", strictGrounding: false },
    tutorStyle: "mixed",
    passages: [],
    focus: (ctx.state as ReturnType<typeof focusState>) ?? null,
    now: Date.UTC(2026, 9, 12, 14, 0),
    sourceCount: 2,
  });
  const r = await generateText({
    model: gen.model,
    system,
    messages: [...history, { role: "user", content: `[Study buddy event, not typed by the learner] ${instr}` }],
    ...gen.options({ thinking: false }),
  });
  return r.text;
}

const enHistory = [
  { role: "user" as const, content: "How do I find the slope between (1,2) and (4,8)?" },
  { role: "assistant" as const, content: "Use m = (y₂ − y₁)/(x₂ − x₁): (8 − 2)/(4 − 1) = 6/3 = 2." },
  { role: "user" as const, content: "ok and what does slope 2 mean on a graph?" },
  { role: "assistant" as const, content: "For every 1 step right, the line goes up 2." },
];
const deHistory = [
  { role: "user" as const, content: "Was ist der Unterschied zwischen Bundestag und Bundesrat?" },
  { role: "assistant" as const, content: "Der Bundestag ist das gewählte Parlament; der Bundesrat vertritt die Länder bei der Gesetzgebung." },
];

const buddy: Task = {
  id: "buddy-instruction",
  purpose: "Study-buddy messages sent by the app at focus-timer events (session start, check-in, recall before break, block quiz, after break, session summary). Meant for learners with ADHD: short, concrete, one next action.",
  dims: ["guidance", "calibration", "tone", "format"],
  cases: [
    { name: "session-start EN", run: async () => { const t = await buddyTurn("session-start", buddyCtx({ state: focusState({ elapsedMs: 0, remainingMs: 25 * 60000, block: 1 }) }), [], "en"); return { output: t, expect: "3-question check-in (energy 1–5, time today, what to finish) plus a 2–4 bullet plan sized to 25 min, under 120 words.", checks: [check("≤120 words", words(t) <= 120, String(words(t))), check("language", lang(t) === "en"), check("no inflated praise", !PRAISE.test(t))] }; } },
    { name: "session-start low", run: async () => { const t = await buddyTurn("session-start", buddyCtx({ state: focusState({ energy: "low", elapsedMs: 0 }) }), [], "en"); return { output: t, expect: "Low energy: no 3-question check-in; one warm sentence and a 2–3 bullet review-only plan; under 70 words.", checks: [check("≤70 words", words(t) <= 70, String(words(t))), check("no check-in questions", questionMarks(t) <= 1, String(questionMarks(t)))] }; } },
    { name: "check-in EN step", run: async () => { const t = await buddyTurn("check-in", buddyCtx({ currentStep: "Do problems 1–3 on page 42" }), enHistory, "en"); return { output: t, expect: "One or two sentences, refers to slope work and asks whether 'problems 1–3 on page 42' is done or blocked.", checks: [check("≤45 words", words(t) <= 45, String(words(t))), check("mentions step", /page 42|problems? 1/i.test(t))] }; } },
    { name: "check-in DE", run: async () => { const t = await buddyTurn("check-in", buddyCtx(), deHistory, "de"); return { output: t, expect: "German, one or two sentences, refers to Bundestag/Bundesrat.", checks: [check("language", lang(t) === "de", lang(t)), check("≤45 words", words(t) <= 45, String(words(t)))] }; } },
    { name: "recall EN", run: async () => { const t = await buddyTurn("recall", buddyCtx(), enHistory, "en"); return { output: t, expect: "1–2 quick recall questions about slope from this chat; nothing long.", checks: [check("1–2 questions", questionMarks(t) >= 1 && questionMarks(t) <= 3, String(questionMarks(t))), check("≤70 words", words(t) <= 70, String(words(t)))] }; } },
    { name: "block-quiz EN parked", run: async () => { const t = await buddyTurn("block-quiz", buddyCtx({ parking: [{ id: "p", text: "look up y-intercept" }] }), enHistory, "en"); return { output: t, expect: "3-question mini quiz on slope, answers below '---', lists 'look up y-intercept' under Parked for later.", checks: [check("answers below ---", /\n-{3,}\s*\n/.test(t)), check("parked listed", /y-intercept/i.test(t))] }; } },
    { name: "block-quiz DE low", run: async () => { const t = await buddyTurn("block-quiz", buddyCtx({ state: focusState({ energy: "low" }) }), deHistory, "de"); return { output: t, expect: "German, 2 easy recall questions, answers below '---', very short.", checks: [check("answers below ---", /\n-{3,}\s*\n/.test(t)), check("language", lang(t) === "de", lang(t)), check("≤90 words", words(t) <= 90, String(words(t)))] }; } },
    { name: "post-break needApp", run: async () => { const t = await buddyTurn("post-break", buddyCtx({ needAppPauses: 2 }), enHistory, "en"); return { output: t, expect: "Gentle note that real breaks help memory (no guilt), then 3-bullet recap and next concrete step.", checks: [check("≤110 words", words(t) <= 110, String(words(t))), check("no guilt words", !/\bshould(n't| not) have\b|\bdisappoint/i.test(t))] }; } },
    { name: "session-summary EN", run: async () => { const t = await buddyTurn("session-summary", buddyCtx({ state: null, previous: focusState({ phase: "idle" }) }), enHistory, "en"); return { output: t, expect: "Journal summary in Markdown: covered / solid / review next (2–4 bullets each) + one sentence on the goal, under 180 words, no preamble.", checks: [check("≤180 words", words(t) <= 180, String(words(t))), check("no preamble", !/^(sure|here('s| is)|okay|great)/i.test(t.trim()))] }; } },
  ],
};

const micro: Task = {
  id: "micro-steps",
  purpose: "Break a study goal into 4–7 tiny physical steps (2–5 minutes each) for a learner with ADHD who struggles to start. JSON output.",
  dims: ["guidance", "calibration", "format"],
  cases: [
    ["Pass the GED math test section on linear equations", "en", "GED prep", ["GED Math Workbook ch. 4", "Khan Academy: Slope"]],
    ["Write my GED extended response essay draft", "en", "GED RLA", ["RLA practice prompts.pdf"]],
    ["Learn the three branches of government", "en", "Civics", []],
    ["Für die Mathe-Klausur Bruchrechnung wiederholen", "de", "Mathe 9. Klasse", ["Arbeitsblatt Brüche.pdf"]],
    ["Kapitel 3 aus dem Biobuch zusammenfassen", "de", "Biologie", ["Biologie heute, Kapitel 3"]],
    ["Review chemistry", "en", null, []],
  ].map(([goal, l, space, titles]) => ({
    name: `${l} ${String(goal).slice(0, 30)}`,
    run: async () => {
      const m = await lib("focus/microSteps.ts");
      let steps: { text: string; minutes: number }[] = [];
      let err = "";
      try {
        steps = await m.generateMicroSteps(gen, { goal, spaceName: space, sourceTitles: titles });
      } catch (e) {
        err = String(e);
      }
      const all = steps.map((s) => s.text).join(" ");
      return {
        output: cur().at(-1)?.output ?? err,
        expect: `Steps in ${l === "de" ? "German" : "English"}; step 1 trivial; concrete; ends with a small check.`,
        checks: [
          check("parsed", steps.length > 0, err),
          check("4–7 steps", steps.length >= 4 && steps.length <= 7, String(steps.length)),
          check("≤14 words each", steps.every((s) => words(s.text) <= 14)),
          check("language", lang(all) === l || lang(all) === "?", lang(all)),
          check("no vague verbs", !/\b(understand|review the topic|verstehen)\b/i.test(all)),
        ],
      };
    },
  })),
};

const gedTopics = [
  { id: "math.slope", title: "Slope and linear equations", description: "slope formula, y = mx + b, graphs of lines", group: "Algebra" },
  { id: "math.pct", title: "Percents", description: "percent change, discounts, tax", group: "Number sense" },
];
const sciTopics = [{ id: "sci.cells", title: "Cell structure", description: "organelles, cell membrane, mitochondria, chloroplasts", group: "Life science" }];
const deTopics = [{ id: "pol.gg", title: "Grundgesetz und Verfassungsorgane", description: "Bundestag, Bundesrat, Bundesverfassungsgericht", group: "Politik" }];

const quiz: Task = {
  id: "mcq-quiz",
  purpose: "Multiple-choice quiz for placement / prerequisite checks / 'Quiz me', 4 options, one correct, one-sentence explanation. JSON output.",
  dims: ["grounding", "calibration", "format"],
  cases: [
    { topics: gedTopics, per: 2, lang: "en", ctx: undefined, purpose: "placement test to find what the learner already knows" },
    { topics: sciTopics, per: 3, lang: "en", ctx: passages.photosynthesis.map((p) => p.text).join("\n"), purpose: "quiz the learner on their sources" },
    { topics: deTopics, per: 3, lang: "de", ctx: passages.verfassung[0].text, purpose: "Quiz zu den Quellen des Lernenden" },
    { topics: deTopics, per: 2, lang: "de", ctx: undefined, purpose: "placement test" },
  ].map((c, i) => ({
    name: `${c.lang} ${c.topics[0].id} #${i}`,
    run: async () => {
      const m = await lib("placement/logic.ts");
      let qs: { question: string; options: string[]; answer: number; topicId: string | null }[] = [];
      let err = "";
      try {
        qs = await m.generateQuiz(gen, { topics: c.topics, perTopic: c.per, context: c.ctx, language: c.lang, purpose: c.purpose });
      } catch (e) {
        err = String(e);
      }
      const all = qs.map((q) => q.question + " " + q.options.join(" ")).join(" ");
      const want = c.topics.length * c.per;
      return {
        output: cur().at(-1)?.output ?? err,
        expect: `${want} questions, 4 options each, ${c.lang === "de" ? "German" : "English"}${c.ctx ? ", only facts from the material" : ""}.`,
        checks: [
          check("parsed", qs.length > 0, err),
          check("count", qs.length === want, `${qs.length}/${want}`),
          check("4 options", qs.every((q) => q.options.length === 4)),
          check("language", lang(all) === c.lang, lang(all)),
          check("no 'all of the above'", !/all of the above|alle (der )?oben/i.test(all)),
          check("topic ids", qs.every((q) => q.topicId != null)),
        ],
      };
    },
  })),
};

const practice: Task = {
  id: "practice-problem",
  purpose: "Generate ONE practice problem at a given difficulty (1–5) with answer, worked solution and a hint that doesn't give the answer away. JSON output.",
  dims: ["withholding", "calibration", "format"],
  cases: [
    { topic: { key: "slope", title: "Slope of a line", description: "slope from two points, GED math" }, level: 2, lang: "en" },
    { topic: { key: "pct", title: "Percent change", description: "discounts and sales tax, GED math" }, level: 3, lang: "en" },
    { topic: { key: "geo", title: "Area and volume", description: "composite figures, GED formula sheet" }, level: 4, lang: "en" },
    { topic: { key: "sci", title: "Scientific method", description: "variables, controls, hypothesis, GED science" }, level: 2, lang: "en" },
    { topic: { key: "brueche", title: "Bruchrechnung", description: "Brüche addieren und kürzen" }, level: 3, lang: "de" },
    { topic: { key: "lgs", title: "Lineare Gleichungssysteme", description: "zwei Gleichungen, zwei Unbekannte" }, level: 5, lang: "de" },
  ].map((c) => ({
    name: `${c.lang} ${c.topic.key} L${c.level}`,
    run: async () => {
      const m = await lib("practice/problems.ts");
      let item: { question: string; answer: string; hint: string | null; kind: string; solution: string } | null = null;
      let err = "";
      try {
        item = await m.generateProblem(gen, { topic: c.topic, level: c.level, language: c.lang });
      } catch (e) {
        err = String(e);
      }
      const hintLeak = !!item && item.kind === "numeric" && !!item.hint && new RegExp(`(^|[^\\d.])${item.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\d.]|$)`).test(item.hint);
      return {
        output: cur()[0]?.output ?? err,
        expect: `One ${c.lang === "de" ? "German" : "English"} problem at level ${c.level}/5, one clear answer, hint without the answer, under 80 words.`,
        checks: [
          check("parsed + verified", !!item, err),
          check("≤80 words", !!item && words(item.question) <= 80, item ? String(words(item.question)) : ""),
          check("one question", !!item && questionMarks(item.question) <= 1),
          check("language", !!item && lang(item.question + " " + item.solution) === c.lang, item ? lang(item.question + " " + item.solution) : ""),
          check("hint doesn't leak", !hintLeak),
          check("first attempt held", cur().filter((x) => !x.prompt.includes("Solve this problem carefully")).length === 1, String(cur().length)),
        ],
      };
    },
  })),
};

const shortItem = (question: string, answer: string) => ({ id: "x", topicKey: "t", kind: "short", question, options: null, answer, solution: answer, difficulty: 0, parentId: null, hint: null, createdAt: 0 });
const grade: Task = {
  id: "grade-short",
  purpose: "Grade a learner's free-text short answer against a model answer; fair to wording and spelling, strict on facts. Gives 1–2 sentences of feedback. JSON output.",
  dims: ["diagnosis", "guidance", "tone", "format"],
  cases: [
    ["What does the legislative branch do?", "It makes laws (Congress).", "congress writes the laws", true, "en"],
    ["What does the legislative branch do?", "It makes laws (Congress).", "it enforces laws", false, "en"],
    ["Name the organelle where photosynthesis happens.", "The chloroplast.", "chloroplasts", true, "en"],
    ["Name the organelle where photosynthesis happens.", "The chloroplast.", "mitochondria", false, "en"],
    ["What is a control group in an experiment?", "The group that doesn't get the treatment, used for comparison.", "the group you compare with that gets nothing changed", true, "en"],
    ["Wen vertritt der Bundesrat?", "Die Länder.", "die bundeslaender", true, "de"],
    ["Wen vertritt der Bundesrat?", "Die Länder.", "das Volk direkt", false, "de"],
    ["What is the independent variable?", "The variable the experimenter changes on purpose.", "the thing you measure", false, "en"],
  ].map(([q, a, r, ok, l]) => ({
    name: `${l} ${ok ? "right" : "wrong"}: ${String(r).slice(0, 24)}`,
    run: async () => {
      const m = await lib("practice/problems.ts");
      let g: { correct: boolean; feedback: string | null } | null = null;
      let err = "";
      try {
        g = await m.gradeResponse(gen, shortItem(String(q), String(a)), String(r));
      } catch (e) {
        err = String(e);
      }
      return {
        output: cur().at(-1)?.output ?? err,
        expect: `Correct verdict is ${ok}. Feedback in ${l === "de" ? "German" : "English"}, 1–2 sentences, names what's missing if wrong.`,
        checks: [
          check("parsed", !!g, err),
          check("verdict", g?.correct === ok, String(g?.correct)),
          check("feedback language", !!g?.feedback && (lang(g.feedback) === l || lang(g.feedback) === "?"), g?.feedback ? lang(g.feedback) : ""),
          check("≤2 sentences", !!g?.feedback && sentenceCount(g.feedback) <= 2),
        ],
      };
    },
  })),
};

const classify: Task = {
  id: "classify-error",
  purpose: "Classify the most likely type of mistake in a wrong answer (closed list) with a one-sentence note. JSON output.",
  dims: ["diagnosis", "format"],
  cases: [
    ["What is 15% of 80?", "12", "1200", ["arithmetic", "procedure", "careless"], "en"],
    ["Solve: -3x = 12", "-4", "4", ["sign"], "en"],
    ["A 2 km walk takes how many meters?", "2000", "200", ["units"], "en"],
    ["What is the slope through (1,2) and (3,8)?", "3", "1/3", ["procedure", "concept"], "en"],
    ["How many apples are left if Ana has 12 and gives away 5 to each of 2 friends?", "2", "7", ["misread", "procedure"], "en"],
    ["Löse: 2(x + 3) = 10", "2", "3.5", ["procedure"], "de"],
  ].map(([q, a, r, ok, l]) => ({
    name: `${l} ${String(q).slice(0, 26)}`,
    run: async () => {
      const m = await lib("practice/problems.ts");
      const res = await m.classifyError(gen, { question: String(q), answer: String(a) }, String(r));
      return {
        output: cur().at(-1)?.output ?? "",
        expect: `Most plausible: ${(ok as string[]).join(" or ")}. Note in ${l === "de" ? "German" : "English"}.`,
        checks: [check("type", (ok as string[]).includes(res.errorType), res.errorType), check("note", !!res.note), check("note language", !!res.note && (lang(res.note) === l || lang(res.note) === "?"), res.note ? lang(res.note) : "")],
      };
    },
  })),
};

const cardPassages = (texts: string[], title: string) => {
  let pos = 0;
  return texts.map((text, i) => {
    const p = { sourceId: `s${i}`, sourceTitle: title, text, start: pos, end: pos + text.length };
    pos += text.length + 2;
    return p;
  });
};
const cards: Task = {
  id: "flashcards",
  purpose: "Make Q&A and cloze flashcards from retrieved passages, one fact per card, each with a supporting exact quote. JSON output.",
  dims: ["grounding", "calibration", "format"],
  cases: [
    { ps: cardPassages(passages.photosynthesis.map((p) => p.text), "Biology notes"), n: 5, lang: "en" },
    { ps: cardPassages([passages.civics[0].text], "GED Social Studies"), n: 4, lang: "en" },
    { ps: cardPassages([passages.verfassung[0].text, "Das Bundesverfassungsgericht in Karlsruhe prüft, ob Gesetze mit dem Grundgesetz vereinbar sind. Seine Entscheidungen binden alle Staatsorgane."], "Politik-Skript"), n: 5, lang: "de" },
    { ps: cardPassages([passages.gedMath[0].text], "GED formula sheet"), n: 3, lang: "en" },
  ].map((c, i) => ({
    name: `${c.lang} #${i}`,
    run: async () => {
      const m = await lib("srs/generate.ts");
      let out: { front: string; back: string; kind: string }[] = [];
      let err = "";
      try {
        out = await m.generateCards(gen, c.ps, { count: c.n });
      } catch (e) {
        err = String(e);
      }
      const raw = (await lib("chat/json.ts")).extractJson(cur().at(-1)?.output ?? "") as { quote?: string; passage?: number }[] | null;
      const quotes = Array.isArray(raw) ? raw : [];
      const quoteHits = quotes.filter((q) => q.quote && c.ps[(q.passage ?? 1) - 1]?.text.includes(q.quote.trim())).length;
      const all = out.map((x) => `${x.front} ${x.back}`).join(" ");
      return {
        output: cur().at(-1)?.output ?? err,
        expect: `${c.n} cards in ${c.lang === "de" ? "German" : "English"}, mix of basic and cloze, only facts from the passages.`,
        checks: [
          check("parsed", out.length > 0, err),
          check("count", out.length === c.n, String(out.length)),
          check("exact quotes", quotes.length > 0 && quoteHits / quotes.length >= 0.8, `${quoteHits}/${quotes.length}`),
          check("both kinds", new Set(out.map((x) => x.kind)).size === 2),
          check("language", lang(all.replace(/\{\{c\d::|\}\}/g, "")) === c.lang, lang(all)),
        ],
      };
    },
  })),
};

const cite = (n: number, text: string) => ({ n, chunkId: n, sourceId: "s", sourceTitle: "src", start: 0, end: 0, page: null, snippet: text.slice(0, 80), text });
const selfcheck: Task = {
  id: "self-check",
  purpose: "Fact-check a tutor answer claim by claim against the cited passages only (supported / partly / unsupported / contradicted). JSON output.",
  dims: ["grounding", "diagnosis", "format"],
  cases: [
    { answer: "The Calvin cycle runs in the stroma [2]. It uses ATP and NADPH [2]. It releases oxygen [2].", cites: passages.photosynthesis.map((p) => cite(p.n, p.text)), bad: /oxygen/i, verdicts: ["unsupported", "contradicted", "partly"] },
    { answer: "Congress makes laws, the President enforces them [1]. The Supreme Court has 9 justices [1].", cites: [cite(1, passages.civics[0].text)], bad: /9 justices|nine/i, verdicts: ["unsupported", "partly"] },
    { answer: "Das Grundgesetz trat 1949 in Kraft [1]. Der Bundestag wird alle fünf Jahre gewählt [1].", cites: [cite(1, passages.verfassung[0].text)], bad: /fünf|5/i, verdicts: ["contradicted"] },
    { answer: "Light reactions happen in the thylakoid membranes [1] and make ATP and NADPH [1].", cites: passages.photosynthesis.map((p) => cite(p.n, p.text)), bad: null, verdicts: [] },
  ].map((c, i) => ({
    name: `case ${i}`,
    run: async () => {
      const m = await lib("chat/selfCheck.ts");
      let items: { claim: string; verdict: string }[] = [];
      let err = "";
      try {
        items = (await m.selfCheck(c.answer, c.cites, gen)).items;
      } catch (e) {
        err = String(e);
      }
      const flagged = items.filter((x) => x.verdict !== "supported");
      const badFlagged = c.bad ? items.some((x) => c.bad!.test(x.claim) && c.verdicts.includes(x.verdict)) : flagged.length === 0;
      const falseAlarm = items.some((x) => x.verdict !== "supported" && (!c.bad || !c.bad.test(x.claim)));
      return {
        output: cur().at(-1)?.output ?? err,
        expect: c.bad ? `The claim matching ${c.bad} must be flagged as ${c.verdicts.join("/")}; the rest supported.` : "Everything supported.",
        checks: [check("parsed", items.length > 0, err), check("planted claim caught", badFlagged), check("no false alarm", !falseAlarm)],
      };
    },
  })),
};

const stepcheck: Task = {
  id: "step-check",
  purpose: "Check a learner's worked math steps one by one; for wrong steps name the mistake (issue) and nudge (hint) without revealing the corrected line (only 'fix' may). JSON output.",
  dims: ["diagnosis", "withholding", "guidance", "format"],
  cases: [
    { problem: "Solve 3x + 5 = 20", steps: ["3x = 25", "x = 25/3"], wrong: 0, leak: /3x\s*=\s*15|x\s*=\s*5\b/ },
    { problem: "Solve 2(x - 4) = 10", steps: ["2x - 4 = 10", "2x = 14", "x = 7"], wrong: 0, leak: /2x\s*-\s*8|x\s*=\s*9\b/ },
    { problem: "Solve x/4 - 2 = 3", steps: ["x/4 = 5", "x = 20"], wrong: null, leak: null },
    { problem: "Löse 5x - 3 = 2x + 9", steps: ["3x - 3 = 9", "3x = 6", "x = 2"], wrong: 1, leak: /3x\s*=\s*12|x\s*=\s*4\b/ },
  ].map((c, i) => ({
    name: `case ${i}`,
    run: async () => {
      const m = await lib("steps/check.ts");
      let r: { verdicts: { ok: boolean; issue?: string; hint?: string }[]; firstWrong: number | null } | null = null;
      let err = "";
      try {
        r = await m.checkSteps(gen, { problem: c.problem, steps: c.steps });
      } catch (e) {
        err = String(e);
      }
      const visible = (r?.verdicts ?? []).map((v) => `${v.issue ?? ""} ${v.hint ?? ""}`).join(" ");
      const raw = cur().at(-1)?.output ?? "";
      const parsedRaw = (await lib("chat/json.ts")).extractJson(raw) as { steps?: { ok?: boolean; issue?: string; hint?: string }[] } | null;
      const modelVisible = (parsedRaw?.steps ?? []).map((v) => `${v.issue ?? ""} ${v.hint ?? ""}`).join(" ");
      return {
        output: raw || err,
        expect: c.wrong == null ? "All steps correct." : `First wrong step is step ${c.wrong + 1}; issue/hint must not contain the corrected line or result.`,
        checks: [
          check("parsed", !!r, err),
          check("first wrong", r?.firstWrong === c.wrong, String(r?.firstWrong)),
          check("model hint doesn't leak", !c.leak || !c.leak.test(modelVisible)),
          check("shown hint doesn't leak", !c.leak || !c.leak.test(visible)),
          check("language", i !== 3 || lang(modelVisible) !== "en", lang(modelVisible)),
        ],
      };
    },
  })),
};

const researchQuery: Task = {
  id: "research-query",
  purpose: "Suggest in 1–2 short lines (≤30 words) what new study sources a learner in this space should look for, in the space's language, adding to (not repeating) existing sources.",
  dims: ["calibration", "format"],
  cases: [
    { name: "GED Math", curriculum: { title: "GED Mathematical Reasoning", topics: gedTopics }, sources: [{ title: "Khan Academy: Slope" }], threads: [{ title: "Percent change" }], lang: "en" },
    { name: "Politik 10. Klasse", curriculum: null, sources: [{ title: "Politik-Skript Grundgesetz" }], threads: [{ title: "Bundesrat" }], lang: "de" },
    { name: "Biology", curriculum: null, sources: [], threads: [], lang: "en" },
  ].map((c) => ({
    name: c.name,
    run: async () => {
      const m = await lib("research/prompts.ts");
      const q: string = await m.generateResearchQuery({ name: c.name, curriculum: c.curriculum, sources: c.sources, threads: c.threads }, { llm: gen });
      return {
        output: q,
        expect: `≤30 words, ${c.lang === "de" ? "German" : "English"}, about new material for "${c.name}".`,
        checks: [check("≤30 words", words(q) <= 30, String(words(q))), check("language", lang(q) === c.lang || lang(q) === "?", lang(q)), check("not a repeat", !c.sources.some((s) => q.includes(s.title)))],
      };
    },
  })),
};

const researchPlan: Task = {
  id: "research-plan",
  purpose: "Plan 3–5 web search queries to find trustworthy free study material for a learner's question, mixing the learner's language and English, plus the question's ISO language. JSON output.",
  dims: ["calibration", "format"],
  cases: [
    ["GED science: how do vaccines train the immune system", "en"],
    ["Wie funktioniert die Gewaltenteilung im Grundgesetz?", "de"],
    ["GED math percent change practice problems with solutions", "en"],
    ["Photosynthese Lichtreaktion und Calvin-Zyklus einfach erklärt", "de"],
  ].map(([q, l]) => ({
    name: `${l} ${q.slice(0, 30)}`,
    run: async () => {
      const m = await lib("research/deepResearch.ts");
      const plan: { queries: string[]; language: string } = await m.planQueries(q, { llm: gen, http: async () => ({ status: 500, body: "" }) });
      const inLang = plan.queries.filter((x) => lang(x) === "de").length;
      return {
        output: cur().at(-1)?.output ?? "",
        expect: `language "${l}", 3–5 short queries${l === "de" ? ", about half German and half English" : ""}.`,
        checks: [
          check("3–5 queries", plan.queries.length >= 3 && plan.queries.length <= 5, String(plan.queries.length)),
          check("language code", plan.language === l, plan.language),
          check("short queries", plan.queries.every((x) => words(x) <= 12)),
          check("mixed languages", l === "en" || (inLang >= 1 && inLang < plan.queries.length), `${inLang}/${plan.queries.length} de`),
        ],
      };
    },
  })),
};

const page = (title: string, url: string, markdown: string) => ({ title, url, markdown, snippet: "", engine: "duckduckgo" as const });
const researchRank: Task = {
  id: "research-rank",
  purpose: "Rate fetched web pages for relevance (0–100) to the learner's exact question and credibility, with a one-line summary. JSON output.",
  dims: ["grounding", "calibration", "format"],
  cases: [
    {
      q: "How does the Calvin cycle fix carbon dioxide?",
      pages: [
        page("Calvin cycle - Wikipedia", "https://en.wikipedia.org/wiki/Calvin_cycle", "The Calvin cycle is the set of light-independent reactions of photosynthesis in the stroma. RuBisCO fixes CO2 to ribulose bisphosphate, producing 3-phosphoglycerate, which is reduced using ATP and NADPH."),
        page("Carnot cycle - Wikipedia", "https://en.wikipedia.org/wiki/Carnot_cycle", "The Carnot cycle is an idealized thermodynamic cycle consisting of two isothermal and two adiabatic processes. It sets an upper limit on heat engine efficiency."),
        page("Best cycling routes 2026", "https://bikes-deals.example.com/routes", "Top 10 cycling routes! Buy now and get 20% off helmets. Cycle your way to fitness."),
        page("Photosynthesis overview | OpenStax Biology", "https://openstax.org/books/biology-2e/pages/8-1", "Photosynthesis has two stages: the light-dependent reactions and the Calvin cycle. In the Calvin cycle, carbon dioxide is incorporated into organic molecules."),
      ],
      good: [0, 3],
      bad: [1, 2],
    },
    {
      q: "Was macht der Bundesrat?",
      pages: [
        page("Bundesrat – bpb", "https://www.bpb.de/bundesrat", "Der Bundesrat ist das Verfassungsorgan, über das die Länder an der Gesetzgebung und Verwaltung des Bundes mitwirken."),
        page("Schweizer Bundesrat", "https://de.wikipedia.org/wiki/Bundesrat_(Schweiz)", "Der Bundesrat ist die Regierung der Schweizerischen Eidgenossenschaft und besteht aus sieben Mitgliedern."),
        page("Rätsel: Wörter mit Rat", "https://raetsel.example.de/rat", "Kreuzworträtsel-Hilfe: Wörter mit RAT – Ratgeber, Rathaus, Bundesrat. Jetzt Premium holen!"),
      ],
      good: [0],
      bad: [2],
    },
  ].map((c, i) => ({
    name: `case ${i}`,
    run: async () => {
      const m = await lib("research/deepResearch.ts");
      const text = (await generateText({ model: gen.model, system: m.DEFAULT_RESEARCH_SYSTEM_PROMPT ?? (await lib("research/prompts.ts")).DEFAULT_RESEARCH_SYSTEM_PROMPT, prompt: m.rankPrompt(c.q, c.pages), ...gen.options({ thinking: false }) })).text;
      const ratings = (await lib("chat/json.ts")).extractJson(text) ?? [];
      const rated = m.applyRatings(c.pages, Array.isArray(ratings) ? ratings : []) as { relevance: number }[];
      const kept = m.filterAndSort(rated.map((r, k) => ({ ...r, id: String(k) }))) as { id: string }[];
      const keptIdx = kept.map((k) => Number(k.id));
      return {
        output: text,
        expect: `Pages ${c.good.join(",")} relevant (≥55); pages ${c.bad.join(",")} low.`,
        checks: [check("good kept", c.good.every((g) => keptIdx.includes(g)), keptIdx.join(",")), check("bad dropped", c.bad.every((b) => !keptIdx.includes(b)), keptIdx.join(","))],
      };
    },
  })),
};

const summaryTexts: [string, string, "en" | "de"][] = [
  ["GED Social Studies: Checks and Balances", `${passages.civics[0].text} The President can veto bills passed by Congress, and Congress can override a veto with a two-thirds vote in both houses. The Supreme Court can declare laws unconstitutional through judicial review, established in Marbury v. Madison (1803). The Senate confirms federal judges nominated by the President.`, "en"],
  ["Photosynthesis", passages.photosynthesis.map((p) => p.text).join(" ") + " Factors such as light intensity, carbon dioxide concentration and temperature limit the rate of photosynthesis.", "en"],
  ["Grundgesetz", `${passages.verfassung[0].text} Die Grundrechte stehen in den Artikeln 1 bis 19. Artikel 1 schützt die Würde des Menschen. Das Bundesverfassungsgericht wacht über die Einhaltung des Grundgesetzes.`, "de"],
  ["Bruchrechnung Arbeitsblatt", "Brüche werden addiert, indem man sie auf einen gemeinsamen Nenner bringt. Beispiel: 1/4 + 1/6 = 3/12 + 2/12 = 5/12. Beim Multiplizieren werden Zähler mit Zähler und Nenner mit Nenner multipliziert. Kürzen bedeutet, Zähler und Nenner durch dieselbe Zahl zu teilen.", "de"],
];
const summary: Task = {
  id: "source-summary",
  purpose: "2–3 sentence summary of a study source for the learner: what it covers and what it's useful for, in the material's language, no preamble.",
  dims: ["grounding", "calibration", "format"],
  cases: summaryTexts.map(([title, text, l]) => ({
    name: `${l} ${title}`,
    run: async () => {
      const m = await lib("sources/summary.ts");
      const t: string = await m.summarizeText(gen, title, text);
      const sentences = sentenceCount(t);
      return {
        output: t,
        expect: `2–3 sentences saying what the source covers and what it is useful for (the prompt asks for both), ${l === "de" ? "German" : "English"}, no preamble, no facts beyond the text.`,
        checks: [check("2–3 sentences", sentences >= 2 && sentences <= 3, String(sentences)), check("language", lang(t) === l, lang(t)), check("no preamble", !/^(sure|here|this is a summary|zusammenfassung:|summary:)/i.test(t.trim()))],
      };
    },
  })),
};

const syllabi: [string, "en" | "de"][] = [
  ["GED Mathematical Reasoning: number operations, fractions and decimals, ratios and proportions, percents, exponents and roots, scientific notation, algebraic expressions, linear equations, inequalities, systems of equations, quadratic equations, functions and graphs, slope, perimeter and area, volume and surface area, statistics (mean, median, mode, range), probability, data displays.", "en"],
  ["Abschlussprüfung Fachinformatiker AE, Teil 2: Softwareentwicklung (Algorithmen, OOP, UML-Klassendiagramme, Entwurfsmuster), Datenbanken (ER-Modell, Normalisierung, SQL SELECT/JOIN/GROUP BY), Netzwerktechnik (OSI, IPv4/IPv6, Subnetting), IT-Sicherheit (Verschlüsselung, Schutzziele), Qualitätssicherung (Testverfahren, Unit-Tests).", "de"],
  ["Week 1 cell theory; week 2 cell membranes and transport; week 3 cellular respiration; week 4 photosynthesis; week 5 mitosis and meiosis; week 6 Mendelian genetics; week 7 DNA structure and replication; week 8 protein synthesis; week 9 evolution and natural selection; week 10 ecology.", "en"],
];
const curriculum: Task = {
  id: "custom-curriculum",
  purpose: "Turn a pasted syllabus into a curriculum of 5–25 topics in learning order, grouped, in the syllabus's language. JSON output.",
  dims: ["grounding", "calibration", "format"],
  cases: syllabi.map(([text, l], i) => ({
    name: `${l} #${i}`,
    run: async () => {
      const m = await lib("placement/customCurriculum.ts");
      let r: { title: string | null; topics: { title: string; group: string }[] } | null = null;
      let err = "";
      try {
        r = await m.generateCustomCurriculum(gen, text);
      } catch (e) {
        err = String(e);
      }
      const all = (r?.topics ?? []).map((t) => t.title).join(". ");
      return {
        output: cur().at(-1)?.output ?? err,
        expect: `5–25 topics in learning order, grouped, ${l === "de" ? "German" : "English"}. Topics come from the syllabus; descriptions may add the standard keywords a topic covers (they are used to match sources).`,
        checks: [check("parsed", !!r, err), check("5–25 topics", !!r && r.topics.length >= 5 && r.topics.length <= 25, String(r?.topics.length)), check("groups", !!r && new Set(r.topics.map((t) => t.group)).size >= 2), check("language", l === "en" || lang(all + " und die der") === "de")],
      };
    },
  })),
};

const examTask: Task = {
  id: "exam-questions",
  purpose: "Timed practice-exam multiple-choice questions matching the real test's style and difficulty (GED/SAT), exact per-topic counts, 4 options, one-sentence explanation. JSON output.",
  dims: ["calibration", "format"],
  cases: [
    { exam: "ged", section: "math", topics: gedTopics, n: 6 },
    { exam: "ged", section: "rla", topics: [{ id: "ged.rla.reading", title: "Reading for meaning", description: "main idea, inference, word meaning in context", group: "Reasoning Through Language Arts" }], n: 4 },
    { exam: "sat", section: "rw", topics: [{ id: "sat.rw.conventions", title: "Standard English Conventions", description: "sentence boundaries, punctuation, agreement", group: "Reading and Writing" }], n: 4 },
  ].map((c) => ({
    name: `${c.exam} ${c.section}`,
    run: async () => {
      const f = await lib("exam/formats.ts");
      const g = await lib("exam/generate.ts");
      const format = f.examById(c.exam);
      const section = format.sections.find((x: { id: string }) => x.id === c.section);
      let qs: { question: string; options: string[]; topicId: string | null }[] = [];
      let err = "";
      try {
        qs = await g.generateExamQuestions(gen, format, section, c.topics, c.n);
      } catch (e) {
        err = String(e);
      }
      const all = qs.map((q) => q.question + " " + q.options.join(" ")).join(" ");
      return {
        output: cur().map((x) => x.output).join("\n---\n") || err,
        expect: `${c.n} ${format.title} ${section.title} questions in the real test's style (passages or scenarios where the real test has them), mostly medium, 4 plausible options.`,
        checks: [
          check("count", qs.length === c.n, `${qs.length}/${c.n}`),
          check("4 options", qs.every((q) => q.options.length === 4)),
          check("no 'all of the above'", !/all of the above/i.test(all)),
          check("no picture needed", !/\b(see|shown in) the (figure|diagram|picture|image)\b/i.test(all)),
          check("language", lang(all) === "en", lang(all)),
        ],
      };
    },
  })),
};

const essayTaskEval: Task = {
  id: "essay-task",
  purpose: "GED extended-response reading material: a debatable issue, two opposing 250–350 word passages with a mix of strong and weak evidence, and the standard GED prompt. JSON output.",
  dims: ["calibration", "format"],
  cases: [[], ["school uniforms", "daylight saving time"]].map((avoid, i) => ({
    name: `task #${i}`,
    run: async () => {
      const m = await lib("exam/essay.ts");
      let t: { issue: string; passages: { text: string }[] } | null = null;
      let err = "";
      try {
        t = await m.generateEssayTask(gen, avoid);
      } catch (e) {
        err = String(e);
      }
      const lens = t?.passages.map((p) => words(p.text)) ?? [];
      return {
        output: cur().at(-1)?.output ?? err,
        expect: "Two opposing passages of 250–350 words on an adult public-policy issue; one is clearly better supported; fictional experts; GED prompt wording.",
        checks: [
          check("parsed", !!t, err),
          check("250–350 words each", lens.length === 2 && lens.every((n) => n >= 220 && n <= 380), lens.join("/")),
          check("avoids issues", !!t && !m.repeatsIssue(t.issue, avoid), t?.issue),
        ],
      };
    },
  })),
};

const essayFixture = {
  issue: "Four-day school week",
  prompt: "In your response, analyze both positions presented in the articles to determine which one is best supported. Use relevant and specific evidence from the articles to support your response.",
  passages: [
    {
      title: "A Shorter Week Works",
      text: "Districts that switched to a four-day week report real savings. The Pine Valley district cut transportation and heating costs by 7 percent in its first year, according to its budget office. Teachers say the change helps recruitment: in a survey of 410 teachers by the fictional Rural Education Council, 78 percent said a four-day schedule would make them more likely to accept a job. Students also benefit from longer school days, which allow for full science labs and uninterrupted reading blocks. Superintendent Dana Ruiz notes that attendance rose after the switch because families schedule doctor visits on Fridays instead of pulling children out of class. Critics worry about learning loss, but test scores in Pine Valley held steady. A shorter week is a practical way for small districts to stretch thin budgets and keep good teachers.",
    },
    {
      title: "Keep Five Days",
      text: "A four-day week sounds appealing, but the evidence should give us pause. A study of 12 districts by the fictional Center for School Research found that students in four-day districts gained about 20 percent less in math over three years than similar students on five-day schedules. Savings are small, too: most districts save between 0.4 and 2.5 percent of their budgets, because teacher salaries, the largest cost, do not change. Working parents must find and pay for care on the fifth day, a burden that falls hardest on low-income families. Some districts report that children are left unsupervised. My neighbor says her son is bored every Friday. Before we change the school calendar, we should be sure it helps students learn, not just adults save money.",
    },
  ],
};

const strongEssay = `The article "Keep Five Days" presents the better-supported position. Its central claim, that a four-day week can hurt learning, rests on a study of 12 districts that found students gained about 20 percent less in math over three years. That is a direct measure of what schools exist to do. By contrast, "A Shorter Week Works" says test scores in Pine Valley "held steady," but that is one district, with no comparison group and no numbers.

The pro article's strongest evidence is financial, yet even here the opposing article answers it. Pine Valley saved 7 percent, but "Keep Five Days" explains that most districts save only 0.4 to 2.5 percent because salaries do not change. A single favorable example does not outweigh a range drawn from many districts.

Both articles use some weak support. The teacher survey in the first article measures willingness to take a job, not student results, and the superintendent's claim about attendance is not backed by data. The second article's anecdote about a bored neighbor adds nothing. However, once the weaker points are set aside, the five-day article still offers broader and more relevant evidence: a multi-district study, a cost range, and a concrete burden on working families.

For these reasons, the argument to keep a five-day week is better supported. It focuses on learning outcomes and backs its claims with evidence from more than one district, while the four-day article relies mostly on one district's experience and on opinions.`;

const weakEssay = `I think four day weeks are good because kids get tired and need rest. When I was in school I was always tired on fridays. Teachers also need a break they work really hard. Saving money is good for the school to. So the first article is better because it says they saved money and teachers like it. Also kids can go to the doctor on friday.`;

const essayGradeEval: Task = {
  id: "essay-grade",
  purpose: "Score a GED extended response against the three-trait GED rubric (0–2 each) with short, concrete reasons that quote the essay. JSON output.",
  dims: ["calibration", "diagnosis", "tone", "format"],
  cases: [
    { name: "strong", essay: strongEssay, range: [5, 6] },
    { name: "weak", essay: weakEssay, range: [0, 2] },
    { name: "off-topic", essay: "My favorite season is summer because we go to the lake. ".repeat(6), range: [0, 0] },
  ].map((c) => ({
    name: c.name,
    run: async () => {
      const m = await lib("exam/essay.ts");
      let g: { total: number; traits: { reason: string }[] } | null = null;
      let err = "";
      try {
        g = await m.gradeEssay(gen, essayFixture, c.essay);
      } catch (e) {
        err = String(e);
      }
      const reasons = g?.traits.map((t) => t.reason).join(" ") ?? "";
      return {
        output: `ESSAY:\n${c.essay}\n\nSCORE:\n${cur().at(-1)?.output ?? err}`,
        expect: `Total ${c.range[0]}–${c.range[1]} of 6. Reasons quote the essay and say what would raise the score.`,
        checks: [
          check("parsed", !!g, err),
          check("total in range", !!g && g.total >= c.range[0] && g.total <= c.range[1], String(g?.total)),
          check("no praise", !PRAISE.test(reasons)),
        ],
      };
    },
  })),
};

const studioMaterial = {
  en: {
    sources: ["Biology notes", "Plant physiology handout"],
    passages: [
      ...passages.photosynthesis.map((x) => ({ source: 1, text: x.text })),
      { source: 2, text: "In 1771 Joseph Priestley showed that a mint plant could restore air in which a candle had burned out. In 1779 Jan Ingenhousz found that only the green parts of plants do this, and only in light. In the 1950s Melvin Calvin traced the path of carbon through the cycle that now carries his name." },
      { source: 2, text: "C4 plants such as maize first fix carbon dioxide into a four-carbon compound in mesophyll cells, then release it to the Calvin cycle in bundle-sheath cells. This limits photorespiration in hot, dry conditions. About 3% of plant species use C4 photosynthesis, but they account for roughly 23% of the carbon fixed on land." },
      { source: 2, text: "The overall equation is 6 CO2 + 6 H2O + light energy → C6H12O6 + 6 O2. Chlorophyll a absorbs mostly blue (about 430 nm) and red (about 662 nm) light, which is why leaves look green." },
    ],
    summaries: [],
  },
  de: {
    sources: ["Politik-Skript"],
    passages: [
      ...passages.verfassung.map((x) => ({ source: 1, text: x.text })),
      { source: 1, text: "Der Bundespräsident wird von der Bundesversammlung für fünf Jahre gewählt. Die Bundesregierung besteht aus dem Bundeskanzler und den Bundesministern. Der Bundeskanzler wird vom Bundestag gewählt und bestimmt die Richtlinien der Politik." },
      { source: 1, text: "Das Bundesverfassungsgericht in Karlsruhe prüft, ob Gesetze mit dem Grundgesetz vereinbar sind. Die Artikel 1 bis 19 enthalten die Grundrechte. Artikel 20 legt fest, dass Deutschland ein demokratischer und sozialer Bundesstaat ist." },
    ],
    summaries: [],
  },
};

const studioOutputs: Task = {
  id: "studio-outputs",
  purpose: "Studio outputs built only from the learner's own material: report with [n] citations, cheat sheet, worksheet with answer key, timeline, comparison table, mind map, Mermaid diagram, slide deck and infographic plan. JSON output.",
  dims: ["grounding", "calibration", "format"],
  cases: (
    [
      ["report", "en"],
      ["report", "de"],
      ["cheatsheet", "en"],
      ["worksheet", "en"],
      ["timeline", "en"],
      ["table", "en"],
      ["mindmap", "de"],
      ["diagram", "en"],
      ["slides", "en"],
      ["infographic", "en"],
      ["audio", "en", "brief"],
      ["audio", "de", "deepDive"],
      ["audio", "en", "debate"],
    ] as [string, "en" | "de", string?][]
  ).map(([kind, l, style]) => ({
    name: `${kind}${style ? ` ${style}` : ""} ${l}`,
    run: async () => {
      const g = await lib("studio/generate.ts");
      const m = studioMaterial[l];
      let r: { title: string; data: Record<string, any> } | null = null;
      let err = "";
      try {
        r = await g.generateOutput(gen, kind, m, undefined, undefined, style);
      } catch (e) {
        err = String(e);
      }
      const d = r?.data ?? {};
      const text = JSON.stringify(d);
      const kindChecks: Check[] = [];
      if (kind === "report") {
        const cites = [...String(d.markdown).matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
        kindChecks.push(check("cites", cites.length >= 3, String(cites.length)), check("valid [n]", cites.every((n) => n >= 1 && n <= m.sources.length), cites.join(",")));
      }
      if (kind === "worksheet") kindChecks.push(check("8–12 questions", (d.questions?.length ?? 0) >= 8 && d.questions.length <= 12, String(d.questions?.length)));
      if (kind === "timeline") kindChecks.push(check("≥3 events", (d.events?.length ?? 0) >= 3, String(d.events?.length)));
      if (kind === "table") kindChecks.push(check("3–6 columns", (d.columns?.length ?? 0) >= 3 && d.columns.length <= 6, String(d.columns?.length)));
      if (kind === "slides") kindChecks.push(check("6–10 slides", (d.slides?.length ?? 0) >= 6 && d.slides.length <= 10, String(d.slides?.length)));
      if (kind === "infographic") {
        const nums = (d.stats ?? []).map((x: { value: string }) => x.value.match(/\d+/)?.[0]).filter(Boolean) as string[];
        const src = m.passages.map((x) => x.text).join(" ");
        kindChecks.push(check("stats from material", nums.every((n) => src.includes(n)), nums.join(",")));
      }
      if (kind === "diagram") kindChecks.push(check("no styling", !/\bstyle\b|classDef|<br|%%/.test(String(d.code))));
      if (kind === "audio") {
        const lines: { host: number; text: string }[] = d.lines ?? [];
        const total = lines.reduce((n, x) => n + words(x.text), 0);
        const [lo, hi] = style === "brief" ? [6, 10] : style === "deepDive" ? [10, 26] : [12, 20];
        kindChecks.push(
          check(`${lo}–${hi} lines`, lines.length >= lo && lines.length <= hi, String(lines.length)),
          check("lines ≤60 words", lines.every((x) => words(x.text) <= 65), String(Math.max(0, ...lines.map((x) => words(x.text))))),
          check("length", style === "brief" ? total <= 400 : style === "deepDive" ? total >= 300 && total <= 1600 : total >= 300, String(total)),
          check("no host labels", !lines.some((x) => /\bhost [ab]\b/i.test(x.text))),
        );
      }
      return {
        output: cur().at(-1)?.output ?? err,
        expect: `A ${kind} in ${l === "de" ? "German" : "English"} built only from the material; title at most 8 words.`,
        checks: [
          check("parsed", !!r, err),
          check("title ≤8 words", !!r && words(r.title) <= 8, r?.title),
          check("language", l === "en" ? lang(text) !== "de" : lang(text + " und die der") === "de", lang(text)),
          ...kindChecks,
        ],
      };
    },
  })),
};

const TASKS: Task[] = [tutor, voiceTutor, buddy, micro, quiz, practice, grade, classify, cards, selfcheck, stepcheck, researchQuery, researchPlan, researchRank, summary, curriculum, examTask, essayTaskEval, essayGradeEval, studioOutputs];

// ---------- judge ----------
async function judge(task: Task, caseName: string, r: CaseResult, prompt: string): Promise<Record<string, number> & { rationale?: unknown }> {
  const jm = liveModel(judgeModel);
  const rubric = task.dims.map((d) => `- ${d}: ${DIM_TEXT[d]}`).join("\n");
  const text = (
    await generateText({
      model: jm.model,
      ...jm.options({ thinking: false }),
      system: "You grade outputs of prompts used in a study app for adult learners (many preparing for the GED, some with ADHD). Be strict and consistent. Use the anchored scale; 5 is rare. Word, sentence and item counts are checked by code, so don't count them yourself; judge length only when it is clearly far off. `{{general}}…{{/general}}`, `{{followup: …}}` and `{{remember: …}}` are app markers the app strips or renders; treat them as valid syntax. Emoji and opening praise (\"Great question\", \"Gute Frage\") count against tone.",
      prompt: `<purpose>${task.purpose}</purpose>\n<case>${caseName}</case>\n<expected>${r.expect}</expected>\n<prompt_sent>\n${prompt.slice(0, 7000)}\n</prompt_sent>\n<model_output>\n${r.output.slice(0, 5000)}\n</model_output>\n\nScore each dimension 1–5:\n${rubric}\n\nReturn JSON only: {"rationale": "one or two sentences", ${task.dims.map((d) => `"${d}": 1-5`).join(", ")}}`,
    })
  ).text;
  const { extractJson } = await import("../src/lib/chat/json");
  const o = extractJson<Record<string, unknown>>(text) ?? {};
  const scores: Record<string, number> = {};
  for (const d of task.dims) {
    const v = Number(o[d]);
    if (Number.isFinite(v) && v >= 1 && v <= 5) scores[d] = v;
  }
  return Object.assign(scores, { rationale: o.rationale });
}

// ---------- run ----------
interface Row {
  task: string;
  case: string;
  sample: number;
  checks: Check[];
  judge: Record<string, number>;
  judgeMean: number;
  output: string;
  rationale?: unknown;
  error?: string;
}
interface Summary {
  cases: number;
  checkRate: number;
  judge: number;
  failing: string[];
}
interface Report {
  root: string;
  model: string;
  judgeModel: string;
  at: string;
  summary: Record<string, Summary>;
  rows: Row[];
}

const rows: Row[] = [];
const tasks = TASKS.filter((t) => !only || only.includes(t.id));
for (const task of tasks) {
  const jobs = task.cases.flatMap((c) => Array.from({ length: samples }, (_, s) => ({ c, s })));
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) {
        const { c, s } = jobs[next++];
        try {
          const rec: Call[] = [];
          const r = await store.run(rec, () => c.run());
          if (task.id === "buddy-instruction") r.checks.push(check("no follow-up markers", !r.output.includes("{{followup")));
          if (task.id === "buddy-instruction" || task.id === "tutor-system" || task.id === "tutor-voice") r.checks.push(check("no emoji", !/\p{Extended_Pictographic}/u.test(r.output)));
          const prompt = rec[0]?.prompt ?? "";
          const j = await judge(task, c.name, r, prompt).catch(() => ({}) as Record<string, number>);
          const { rationale, ...scores } = j as Record<string, number> & { rationale?: unknown };
          const vals = Object.values(scores);
          rows.push({ task: task.id, case: c.name, sample: s, checks: r.checks, judge: scores, judgeMean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN, output: r.output, rationale });
        } catch (e) {
          rows.push({ task: task.id, case: c.name, sample: s, checks: [check("ran", false, String(e))], judge: {}, judgeMean: NaN, output: "", error: String(e) });
        }
        process.stdout.write(".");
      }
    }),
  );
  process.stdout.write(` ${task.id}\n`);
}

const summaryOut: Record<string, Summary> = {};
for (const task of tasks) {
  const rs = rows.filter((r) => r.task === task.id);
  const checks = rs.flatMap((r) => r.checks);
  const js = rs.map((r) => r.judgeMean).filter((x) => Number.isFinite(x));
  summaryOut[task.id] = {
    cases: rs.length,
    checkRate: checks.length ? checks.filter((c) => c.pass).length / checks.length : 0,
    judge: js.length ? js.reduce((a, b) => a + b, 0) / js.length : NaN,
    failing: rs.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => `${r.case}: ${c.name}${c.note ? ` (${c.note.slice(0, 60)})` : ""}`)),
  };
}
const report: Report = { root, model: genModel, judgeModel, at: new Date().toISOString(), summary: summaryOut, rows };
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n| prompt | cases | checks | judge |\n|---|---|---|---|`);
for (const [id, s] of Object.entries(summaryOut)) console.log(`| ${id} | ${s.cases} | ${(s.checkRate * 100).toFixed(0)}% | ${s.judge.toFixed(2)} |`);
for (const [id, s] of Object.entries(summaryOut)) if (s.failing.length) console.log(`\n${id} failing:\n  ${s.failing.join("\n  ")}`);
console.log(`\nreport: ${out}`);
