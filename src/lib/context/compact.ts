import { generateText } from "ai";
import { api } from "../ipc";
import type { ResolvedModel } from "../chat/llm";
import type { Message, Thread } from "../types";
import { compactionCut, usableMessages } from "./history";
import { countTokens, truncateToTokens } from "./tokens";

export const COMPACT_SYSTEM =
  "You compress a tutoring conversation into notes the tutor will read instead of the original messages. Write in the language of the conversation. Be specific and dense; never invent anything.";

export function compactPrompt(previous: string | null, transcript: string, focus?: string): string {
  return [
    previous ? `Notes from earlier compactions (fold them in, keep what still matters):\n${previous}\n` : "",
    "Write the notes under these headings, as short bullet points, skipping empty ones:",
    "- Learner: goals, level, preferences stated in the chat",
    "- Covered: facts, explanations, worked results and definitions the learner was given (keep numbers, formulas, names)",
    "- Decisions and agreements (e.g. how to practise, what to skip)",
    "- Misconceptions and mistakes the learner made, and whether they were cleared up",
    "- Progress: what the learner can now do; what they still struggle with",
    "- Open questions and the last thing being worked on",
    "- Sources used: titles with pages or sections that were cited",
    focus ? `\nKeep this in full detail: ${focus}` : "",
    "\nAt most about 600 words. No preamble.",
    `\nConversation:\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function line(m: Message): string {
  const who = m.role === "user" ? "Learner" : m.role === "buddy" ? "Study buddy" : "Tutor";
  const cites = (m.citations ?? [])
    .map((c) => `${c.sourceTitle}${c.page != null ? ` p. ${c.page}` : ""}`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 8);
  return `${who}: ${m.content.replaceAll("{{general}}", "").replaceAll("{{/general}}", "")}${cites.length ? `\n(cited: ${cites.join("; ")})` : ""}`;
}

/** Splits lines into parts of about `tokens` each; a single over-long line is cut. */
export function partition(lines: string[], tokens: number): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const l of lines) {
    const t = countTokens(l);
    if (n + t > tokens && cur.length) {
      parts.push(cur.join("\n\n"));
      cur = [];
      n = 0;
    }
    cur.push(t > tokens ? truncateToTokens(l, tokens).text : l);
    n += Math.min(t, tokens);
  }
  if (cur.length) parts.push(cur.join("\n\n"));
  return parts;
}

/** Summary of `messages`, folded into `previous`; long transcripts go through in parts. */
export async function writeSummary(
  llm: ResolvedModel,
  previous: string | null,
  messages: Message[],
  opts: { focus?: string; partTokens?: number; signal?: AbortSignal } = {},
): Promise<string> {
  let summary = previous;
  for (const part of partition(messages.map(line), opts.partTokens ?? 60_000)) {
    const r = await generateText({
      model: llm.model,
      ...llm.options({ thinking: false }),
      system: COMPACT_SYSTEM,
      prompt: compactPrompt(summary, part, opts.focus),
      abortSignal: opts.signal,
    });
    const text = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) throw new Error("The model returned an empty summary.");
    summary = text;
  }
  return summary ?? "";
}

export interface CompactInput {
  thread: Thread;
  messages: Message[];
  llm: ResolvedModel;
  /** what to keep in detail (`/compact <focus>`) */
  focus?: string;
  /** tokens per summarization call, from the helper model's window */
  partTokens?: number;
  signal?: AbortSignal;
}

/** Summarizes everything before the last few turns and stores it on the thread. Null when there's nothing to compact. */
export async function compactThread({ thread, messages, llm, focus, partTokens, signal }: CompactInput): Promise<Thread | null> {
  const until = thread.summary ? (thread.summaryUntil ?? -Infinity) : -Infinity;
  const live = usableMessages(messages).filter((m) => m.createdAt > until);
  const cut = compactionCut(live);
  if (!cut) return null;
  const covered = live.filter((m) => m.createdAt <= cut.createdAt);
  const summary = await writeSummary(llm, thread.summary ?? null, covered, { focus, partTokens, signal });
  return api.saveThreadSummary(thread.id, summary, cut.createdAt);
}
