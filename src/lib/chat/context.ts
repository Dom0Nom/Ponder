import type { FocusState, Message, Space, TutorStyle } from "../types";

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
    "Tutor style: Socratic. Don't hand over final answers. Ask one guiding question at a time, give hints, and let the learner do the thinking. Confirm or correct their attempts.",
  mixed:
    "Tutor style: mixed. Start with a guiding question or hint; if the learner is stuck or asks directly, explain fully.",
};

export interface ContextInput {
  space: Pick<Space, "name" | "strictGrounding">;
  tutorStyle: TutorStyle;
  passages: Passage[];
  focus: FocusState | null;
  now: number;
  /** total ready sources in the space, to tell "no sources" from "nothing matched" */
  sourceCount: number;
  extraInstructions?: string;
}

export function describeFocus(f: FocusState | null, now: number): string | null {
  if (!f) return null;
  const mins = (ms: number) => Math.max(0, Math.round(ms / 60000));
  const lines: string[] = [];
  const goal = f.goal ? ` Goal: "${f.goal}".` : "";
  if (f.phase === "work") {
    if (f.remainingMs != null) {
      const breakAt = new Date(now + f.remainingMs).toTimeString().slice(0, 5);
      lines.push(
        `The learner is in focus block ${f.block} (${f.technique}), ${mins(f.elapsedMs)} min in, ${mins(f.remainingMs)} min left until a break at ${breakAt}.${goal}`,
      );
      lines.push(
        "Fit your answer into the time left. If a full explanation won't fit before the break, say so up front and give the short version or a first part.",
      );
    } else {
      lines.push(`The learner is in an open-ended flowtime block, ${mins(f.elapsedMs)} min in.${goal}`);
    }
  } else if (f.phase === "break" || f.phase === "longBreak") {
    lines.push(`The learner is on a break (${mins(f.remainingMs ?? 0)} min left).${goal}`);
  }
  if (f.paused) lines.push(`The session is paused (${f.pauseReason === "needApp" ? "they paused a break because they needed the app" : "paused by the learner"}).`);
  if (f.needAppCount > 0) lines.push(`They have interrupted ${f.needAppCount} break(s) this session with "I need the app".`);
  lines.push(`Focus so far: ${mins(f.totalFocusMs)} min, pauses: ${f.pauseCount}.`);
  return lines.join(" ");
}

export function buildSystemPrompt(input: ContextInput): string {
  const { space, passages } = input;
  const parts: string[] = [];
  parts.push(
    `You are a patient, encouraging study tutor inside a learning app. The learner is studying in the space "${space.name}". Reply in the language the learner writes in. Use Markdown; use LaTeX ($...$, $$...$$) for math.`,
  );
  parts.push(TUTOR[input.tutorStyle]);

  if (passages.length > 0) {
    parts.push(
      [
        "Passages from the learner's sources, numbered:",
        ...passages.map(
          (c) => `[${c.n}] (${c.sourceTitle}${c.page != null ? `, p. ${c.page}` : ""})\n${c.text}`,
        ),
      ].join("\n\n"),
    );
    parts.push(
      "Ground your answer in these passages. Cite every claim that comes from them with its number in square brackets right after the claim, like [1] or [2][3]. Only cite a number if that passage actually supports the claim. Never invent citation numbers.",
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

  const focus = describeFocus(input.focus, input.now);
  if (focus) parts.push(`Focus session: ${focus}`);
  if (input.extraInstructions) parts.push(input.extraInstructions);
  return parts.join("\n\n");
}

/** Chat history for the model: drops failed/empty turns and the marker syntax of earlier replies. */
export function historyMessages(
  messages: Message[],
  maxTurns = 12,
): { role: "user" | "assistant"; content: string }[] {
  const usable = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant" || m.role === "buddy") && m.status !== "error" && m.content.trim(),
  );
  return usable.slice(-maxTurns * 2).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content:
      m.role === "buddy"
        ? `(Study buddy note: ${m.content})`
        : m.content.replaceAll("{{general}}", "").replaceAll("{{/general}}", ""),
  }));
}

export function threadTitleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New chat";
}

