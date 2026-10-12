import { s } from "../strings";
import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";

export interface EssayPassage {
  title: string;
  text: string;
}

export interface EssayTask {
  issue: string;
  prompt: string;
  passages: EssayPassage[];
}

export interface TraitScore {
  trait: 1 | 2 | 3;
  score: 0 | 1 | 2;
  reason: string;
}

export interface EssayGrade {
  traits: TraitScore[];
  /** 0–6; the GED counts each point twice */
  total: number;
  summary: string;
}

/**
 * The three traits of the public GED Extended Response rubric (each 0–2), in our own words.
 * Source: GED Testing Service, "Reasoning Through Language Arts Extended Response Resource Guide".
 */
export const TRAITS: { trait: 1 | 2 | 3; name: string; levels: [string, string, string] }[] = [
  {
    trait: 1,
    name: "Creation of arguments and use of evidence",
    levels: [
      "no argument, or the argument isn't connected to the prompt; little or no evidence from the passages, or the passages are mostly copied",
      "an argument that relates to the prompt, with some evidence from the passages that is partly relevant or loosely connected; limited evaluation of the passages' arguments",
      "a clear argument with a purpose tied to the prompt, supported by specific, relevant evidence from the passages, and a sound evaluation of the passages' reasoning and claims",
    ],
  },
  {
    trait: 2,
    name: "Development of ideas and organizational structure",
    levels: [
      "ideas are undeveloped or unclear, with no clear progression or organization",
      "ideas are partly developed; organization and transitions are inconsistent; style only partly fits a formal argument",
      "ideas are well developed with a logical progression, clear organization, effective transitions and a formal style that suits the purpose",
    ],
  },
  {
    trait: 3,
    name: "Clarity and command of standard English",
    levels: [
      "frequent errors in sentence structure, usage and mechanics that get in the way of understanding",
      "some varied sentences and generally correct usage, with errors that sometimes distract",
      "varied, well-controlled sentences and correct usage and mechanics; any errors don't distract",
    ],
  },
];

export const ESSAY_AREAS = ["public health", "technology and privacy", "the environment", "education", "work and wages", "transport", "city and housing", "consumer protection", "food and farming", "sports and recreation"];

export function essayTaskPrompt(avoid: string[] = [], area = ESSAY_AREAS[0]): string {
  return [
    "Write the reading material for a GED-style extended response (argumentative essay) task.",
    `Pick a debatable public-policy or social issue in the area of ${area}, suitable for adults. Write two passages of 250–350 words each that take opposing positions. Each passage uses a mix of strong and weak evidence (statistics, expert quotes, anecdotes, appeals) so a careful reader can judge which argument is better supported. Invent plausible but clearly fictional names for any experts or organisations.`,
    avoid.length ? `The learner has already written about these issues, so the issue must be clearly different from all of them: ${avoid.join("; ")}.` : "",
    'The prompt follows the GED pattern: "In your response, analyze both positions presented in the article(s) to determine which one is best supported. Use relevant and specific evidence from the article(s) to support your response."',
    'Return JSON only: {"issue": "short name of the issue", "prompt": "…", "passages": [{"title": "…", "text": "…"}, {"title": "…", "text": "…"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseEssayTask(text: string): EssayTask | null {
  const o = extractJson<{ issue?: unknown; prompt?: unknown; passages?: unknown }>(text);
  if (!o || typeof o.issue !== "string" || typeof o.prompt !== "string" || !Array.isArray(o.passages)) return null;
  const passages = o.passages
    .map((p) => p as { title?: unknown; text?: unknown })
    .filter((p): p is EssayPassage => typeof p.title === "string" && typeof p.text === "string" && p.text.split(/\s+/).length >= 120);
  if (passages.length !== 2) return null;
  return { issue: o.issue.trim(), prompt: o.prompt.trim(), passages: passages.map((p) => ({ title: p.title.trim(), text: p.text.trim() })) };
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const repeatsIssue = (issue: string, avoid: string[]) => avoid.some((a) => norm(a) && (norm(issue).includes(norm(a)) || norm(a).includes(norm(issue))));

export async function generateEssayTask(llm: ResolvedModel, avoid: string[] = [], signal?: AbortSignal): Promise<EssayTask> {
  const recent = [...new Set(avoid)].slice(-12);
  let fallback: EssayTask | null = null;
  for (let i = 0; i < 3; i++) {
    const area = ESSAY_AREAS[Math.floor(Math.random() * ESSAY_AREAS.length)];
    const r = await generateText({ model: llm.model, prompt: essayTaskPrompt(recent, area), abortSignal: signal, ...llm.options({ thinking: false }) });
    const task = parseEssayTask(r.text);
    if (task && !repeatsIssue(task.issue, recent)) return task;
    fallback ??= task;
  }
  if (fallback) return fallback;
  throw new Error(s.exam.essayTaskFailed);
}

export function essayGradePrompt(task: EssayTask, essay: string): string {
  const rubric = TRAITS.map((t) => [`Trait ${t.trait}: ${t.name}`, ...t.levels.map((l, i) => `  ${i}: ${l}`)].join("\n")).join("\n");
  return [
    "You score a GED-style extended response essay against the rubric below, the way a trained GED scorer would.",
    `PROMPT: ${task.prompt}`,
    ...task.passages.map((p, i) => `PASSAGE ${i + 1}: ${p.title}\n"""\n${p.text}\n"""`),
    `ESSAY:\n"""\n${essay.trim() || "(blank)"}\n"""`,
    `RUBRIC (each trait 0–2):\n${rubric}`,
    [
      "Rules:",
      "- Score each trait on its own; a short essay can still have clean English.",
      "- An essay that is blank, off-topic, not in English, or mostly copied from the passages scores 0 on every trait.",
      "- Each reason is one or two sentences to the learner, naming a concrete spot in the essay (quote a few words) and what would raise the score. No praise phrases.",
      "- summary: one sentence with the most useful next step.",
    ].join("\n"),
    'Return JSON only: {"traits": [{"trait": 1, "score": 0, "reason": "…"}, {"trait": 2, "score": 0, "reason": "…"}, {"trait": 3, "score": 0, "reason": "…"}], "summary": "…"}',
  ].join("\n\n");
}

export function parseEssayGrade(text: string): EssayGrade | null {
  const o = extractJson<{ traits?: unknown; summary?: unknown }>(text);
  if (!o || !Array.isArray(o.traits)) return null;
  const traits: TraitScore[] = [];
  for (const t of [1, 2, 3] as const) {
    const it = o.traits.find((x) => Number((x as { trait?: unknown }).trait) === t) as { score?: unknown; reason?: unknown } | undefined;
    const score = Number(it?.score);
    if (!it || !Number.isInteger(score) || score < 0 || score > 2) return null;
    traits.push({ trait: t, score: score as 0 | 1 | 2, reason: typeof it.reason === "string" ? it.reason.trim() : "" });
  }
  return { traits, total: traits.reduce((n, t) => n + t.score, 0), summary: typeof o.summary === "string" ? o.summary.trim() : "" };
}

/** Under 30 words can't show an argument; the GED gives such responses 0 without reading further. */
export function tooShort(essay: string): boolean {
  return essay.trim().split(/\s+/).filter(Boolean).length < 30;
}

export async function gradeEssay(llm: ResolvedModel, task: EssayTask, essay: string, signal?: AbortSignal): Promise<EssayGrade> {
  if (tooShort(essay))
    return {
      traits: TRAITS.map((t) => ({ trait: t.trait, score: 0, reason: "" })),
      total: 0,
      summary: s.exam.essayTooShort,
    };
  for (let i = 0; i < 2; i++) {
    const r = await generateText({ model: llm.model, prompt: essayGradePrompt(task, essay), abortSignal: signal, ...llm.options({ thinking: false }) });
    const g = parseEssayGrade(r.text);
    if (g) return g;
  }
  throw new Error(s.exam.essayScoreFailed);
}
