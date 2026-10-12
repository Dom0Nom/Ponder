import { extractJson } from "../chat/json";
import type { DatedPlanTask, DueCount, Mistake, Source, Space } from "../types";

export interface BriefingInput {
  today: string;
  weekday: string;
  tasks: DatedPlanTask[];
  due: DueCount[];
  mistakes: Mistake[];
  newSources: { space: string; title: string }[];
}

/** Plain facts the briefing may mention; empty when there is nothing to say. */
export function briefingFacts(b: BriefingInput): string[] {
  const facts: string[] = [];
  const todays = b.tasks.filter((t) => t.date === b.today);
  const bySpace = new Map<string, DatedPlanTask[]>();
  for (const t of todays) bySpace.set(t.spaceName, [...(bySpace.get(t.spaceName) ?? []), t]);
  for (const [space, list] of bySpace) {
    const open = list.filter((t) => !t.doneAt);
    const items = open.map((t) => `${t.title} (${t.kind}, ${t.minutes} min)`).join("; ");
    if (open.length) facts.push(`Plan for ${space}: ${items}.`);
    if (!open.length) facts.push(`Everything planned for ${space} today is done.`);
    else if (list.length > open.length) facts.push(`Already done today in ${space}: ${list.length - open.length} of ${list.length} tasks.`);
  }
  const overdue = b.tasks.filter((t) => !t.doneAt && t.date < b.today).length;
  if (overdue) facts.push(`Unfinished tasks from earlier days: ${overdue}.`);
  for (const d of b.due) {
    const parts = [d.due && `${d.due} due for review`, d.new && `${d.new} new`].filter(Boolean);
    if (parts.length) facts.push(`Flashcards in ${d.spaceName}: ${parts.join(", ")}.`);
  }
  const open = b.mistakes.filter((m) => !m.resolved);
  if (open.length) {
    const topics = [...new Set(open.sort((x, y) => y.createdAt - x.createdAt).map((m) => m.topic ?? m.question.slice(0, 80)))].slice(0, 3);
    facts.push(`Open mistakes to revisit: ${open.length}, most recently about ${topics.join("; ")}.`);
  }
  if (b.newSources.length) facts.push(`New since yesterday: ${b.newSources.map((x) => `"${x.title}" in ${x.space}`).join(", ")}.`);
  return facts;
}

/** First line is stable: the mock backend matches it. */
export function briefingPrompt(b: BriefingInput, facts: string[]): string {
  return [
    `Write a short spoken study briefing for ${b.weekday}.`,
    `FACTS\n"""\n${facts.join("\n")}\n"""`,
    "Talk to the learner directly, warm but brisk, like a coach before a session: 90–170 words. Open with the one thing that matters most today, then the rest in order of importance, and end with a concrete first step.",
    "Use only the facts above; don't invent tasks, numbers or topics. Round nothing, but skip details that don't help.",
    "Write for the ear: no Markdown, no lists, no headings, no emoji. Say numbers the way a person would. Write in the language of the task titles.",
    'Return JSON only:\n{"text": "…"}',
  ].join("\n\n");
}

export function parseBriefing(text: string): string | null {
  const o = extractJson<Record<string, unknown>>(text);
  const t = o && !Array.isArray(o) && typeof o.text === "string" ? o.text.trim() : "";
  return t.length >= 20 ? t : null;
}

export const DAY_MS = 24 * 60 * 60_000;

export function recentSources(spaces: Space[], sources: Source[][], now: number) {
  return spaces.flatMap((sp, i) => sources[i].filter((x) => x.status === "ready" && now - x.createdAt < DAY_MS).map((x) => ({ space: sp.name, title: x.title })));
}
