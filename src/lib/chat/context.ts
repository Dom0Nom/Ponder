import type { FocusState, Message, Space, TutorStyle } from "../types";
import { FOLLOWUP_INSTRUCTION } from "./followUps";
import { MEMORY_INSTRUCTION } from "./memory";
import { toHistory, usableMessages } from "../context/history";

export interface Passage {
  n: number;
  sourceTitle: string;
  page: number | null;
  text: string;
}

const TUTOR: Record<TutorStyle, string> = {
  direct:
    "Tutor style: direct. Explain clearly and give the answer, with the reasoning a learner needs to follow it.",
  socratic:
    "Tutor style: Socratic. Let the learner do the thinking: ask one guiding question per reply and give hints, but don't state the final answer while they are still working on it. Confirm correct steps plainly and point at the exact spot of a mistake. If they have tried and are stuck, or ask for the answer outright, take them one step further (show the next step) instead of repeating the question; after two failed tries, explain the answer with its reasoning.",
  mixed:
    "Tutor style: mixed. Start with one guiding question or hint; if the learner is stuck or asks directly, explain fully.",
};

export const VOICE_INSTRUCTION =
  'Voice conversation: the learner is speaking to you and a speech engine reads your reply aloud, so talk the way a tutor does in person. Hard limits: at most 4 short sentences (about 60 words), plain sentences only (no Markdown, lists, tables, headings, code or emoji), and at most one question, at the end. Say numbers and math in words ("x squared plus three"). Keep the [n] citation marks after cited sentences as usual, but never rely on them in the wording (they are not spoken); name the source in words when it helps. Do not add follow-up lines. If a full answer needs more than that, give the first part and ask whether to go on. Reply in the language the learner just spoke.';

export interface ContextInput {
  /** the answer is read aloud to a learner who is talking */
  voice?: boolean;
  space: Pick<Space, "name" | "strictGrounding">;
  tutorStyle: TutorStyle;
  passages: Passage[];
  focus: FocusState | null;
  now: number;
  /** total ready sources in the space, to tell "no sources" from "nothing matched" */
  sourceCount: number;
  extraInstructions?: string;
  /** learner memory, shared across spaces */
  memory?: string[];
  /** one line per enabled source (title, size, summary, outline) */
  sourceMap?: string;
  /** "full text" sources, already numbered */
  fullText?: string;
  /** retrieved passages travel with the learner's message instead of the system prompt */
  passagesInMessage?: boolean;
  /** the model can read more with tools */
  toolInstruction?: string;
  /** the focus line goes with the learner's message (it changes every minute) */
  focusInMessage?: boolean;
}

export function describeFocus(f: FocusState | null, now: number): string | null {
  if (!f) return null;
  const mins = (ms: number) => Math.max(0, Math.round(ms / 60000));
  const lines: string[] = [];
  const goal = f.goal ? ` Goal: "${f.goal}".` : "";
  const minutes = (n: number) => (n === 1 ? "1 minute" : `${n} minutes`);
  if (f.phase === "work") {
    if (f.remainingMs != null) {
      const breakAt = new Date(now + f.remainingMs).toTimeString().slice(0, 5);
      const left = Math.max(0, Math.round(f.remainingMs / 60000));
      lines.push(
        `The learner is in focus block ${f.block} (${f.technique}), ${minutes(mins(f.elapsedMs))} in. Time left until the break: ${minutes(left)} (the break starts at ${breakAt} clock time).${goal}`,
      );
      const budget = Math.max(60, Math.min(250, left * 30));
      lines.push(
        left <= 8
          ? `Fit your answer into the time left: keep the whole reply under ${budget} words. If a full explanation won't fit before the break, say so in one short line and give the short version or a first part.`
          : "Fit your answer into the time left. If a full explanation won't fit before the break, say so up front and give the short version or a first part.",
      );
    } else {
      lines.push(`The learner is in an open-ended flowtime block, ${minutes(mins(f.elapsedMs))} in.${goal}`);
    }
  } else if (f.phase === "break" || f.phase === "longBreak") {
    lines.push(`The learner is on a break (${minutes(mins(f.remainingMs ?? 0))} left).${goal}`);
  }
  if (f.paused) lines.push(`The session is paused (${f.pauseReason === "needApp" ? "they paused a break because they needed the app" : "paused by the learner"}).`);
  if (f.needAppCount > 0) lines.push(`They have interrupted ${f.needAppCount} break(s) this session with "I need the app".`);
  if (f.energy === "low") {
    lines.push(
      "This is a LOW-ENERGY review session: the learner has little energy today. Help them review and consolidate what they already studied (due flashcards, past mistakes, light re-reading). Do not introduce new material or start new topics. Keep answers under 100 words and gentle, and offer a single small next step. Today's energy level is not a lasting preference, so don't save it to memory.",
    );
  }
  lines.push(`Focus so far: ${mins(f.totalFocusMs)} min, pauses: ${f.pauseCount}.`);
  return lines.join(" ");
}

export function buildSystemPrompt(input: ContextInput): string {
  const { space, passages } = input;
  const parts: string[] = [];
  parts.push(
    `You are a patient, encouraging study tutor inside a learning app. The learner is studying in the space "${space.name}". Reply in the language the learner writes in. Use Markdown; use LaTeX ($...$, $$...$$) for math. Respond to the content directly: no opening praise like "Great question", no emoji, no filler.`,
  );
  parts.push(TUTOR[input.tutorStyle]);
  if (input.memory?.length) {
    parts.push(
      [
        "What you know about this learner from earlier sessions (they can see and edit this list). Use it to adapt explanations, examples and difficulty; don't recite it back:",
        ...input.memory.slice(0, 30).map((m) => `- ${m}`),
      ].join("\n"),
    );
  }
  parts.push(MEMORY_INSTRUCTION);
  parts.push(FOLLOWUP_INSTRUCTION);

  if (input.sourceMap) {
    parts.push(
      `Sources in this space (handles like S3 name them in tools):\n${input.sourceMap}\n\nThis list shows what exists; only numbered passages are quoted text you can cite.`,
    );
  }
  if (input.fullText) parts.push(`Sources the learner put in full (numbered passages):\n\n${input.fullText}`);
  if (input.passagesInMessage) {
    parts.push(
      "Numbered passages from the learner's sources come with their message (and above, for sources in full). Ground your answer in them. Every sentence that uses information from a passage must end with that passage's number in square brackets, like [1] or [2][3] — including sentences in your direct answer, not only the first one. Only cite a number if that passage actually supports the sentence. Never invent citation numbers. When the passages don't cover the question, say so and name the sources from the list above that probably do.",
    );
    if (input.toolInstruction) parts.push(input.toolInstruction);
    if (input.sourceCount === 0) parts.push("This space has no sources yet.");
  } else if (passages.length > 0) {
    parts.push(
      [
        "Passages from the learner's sources, numbered:",
        ...passages.map(
          (c) => `[${c.n}] (${c.sourceTitle}${c.page != null ? `, p. ${c.page}` : ""})\n${c.text}`,
        ),
      ].join("\n\n"),
    );
    parts.push(
      "Ground your answer in these passages. Every sentence that uses information from a passage must end with that passage's number in square brackets, like [1] or [2][3] — including sentences in your direct answer, not only the first one. Only cite a number if that passage actually supports the sentence. Never invent citation numbers.",
    );
  } else if (input.sourceCount > 0) {
    parts.push("No passage in the learner's sources matched this question.");
  } else {
    parts.push("This space has no sources yet.");
  }

  if (space.strictGrounding) {
    parts.push(
      "Strict mode: answer only from the passages above. If they don't contain the answer, say that the sources don't cover it and suggest what kind of source to add. Do not use general knowledge.",
    );
  } else {
    parts.push(
      "You may add general knowledge that is not in the passages, but wrap every such part in {{general}} and {{/general}} markers so the app can label it as not from the learner's sources. Example: {{general}}Water boils at 100 °C at sea level.{{/general}}",
    );
  }

  const focus = input.focusInMessage ? null : describeFocus(input.focus, input.now);
  if (focus) parts.push(`Focus session: ${focus}`);
  if (input.extraInstructions) parts.push(input.extraInstructions);
  if (input.voice) parts.push(VOICE_INSTRUCTION);
  return parts.join("\n\n");
}

/** Chat history for the model: every usable turn, without failed/empty turns or answer markers. */
export function historyMessages(messages: Message[]): { role: "user" | "assistant"; content: string }[] {
  return usableMessages(messages).map(toHistory);
}

export function threadTitleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New chat";
}

