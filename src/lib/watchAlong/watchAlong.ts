import { extractJson } from "../chat/json";
import { youTubeId } from "../importers/youtube";

export interface Segment {
  /** seconds into the video */
  sec: number;
  text: string;
}

export interface Checkpoint {
  /** pause here (seconds); the last one sits at the end of the transcript */
  at: number;
  from: number;
  text: string;
}

const STAMP = /^\[(?:(\d+):)?(\d+):(\d{2})\]\s*/;

/** Reads a transcript imported by the YouTube importer: the video id from its "YouTube:" line and one segment per "[m:ss]" paragraph. */
export function parseTranscript(text: string): { videoId: string | null; segments: Segment[] } {
  const url = /^YouTube:\s*(\S+)/m.exec(text)?.[1];
  const segments: Segment[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const m = STAMP.exec(para.trim());
    if (!m) continue;
    const sec = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const body = para.trim().slice(m[0].length).trim();
    if (body) segments.push({ sec, text: body });
  }
  return { videoId: url ? youTubeId(url) : null, segments };
}

/** Groups segments into stretches of at least `every` seconds; each ends where the next begins. */
export function checkpoints(segments: Segment[], every = 240): Checkpoint[] {
  const out: Checkpoint[] = [];
  let cur: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    cur.push(segments[i]);
    const next = segments[i + 1];
    if (!next) break;
    if (next.sec - cur[0].sec >= every) {
      out.push({ at: next.sec, from: cur[0].sec, text: cur.map((x) => x.text).join(" ") });
      cur = [];
    }
  }
  if (cur.length) {
    const last = cur[cur.length - 1];
    const text = cur.map((x) => x.text).join(" ");
    // a short tail joins the previous stretch rather than earning its own question
    if (out.length && last.sec - cur[0].sec < every / 3) {
      const prev = out.pop()!;
      out.push({ at: last.sec + 45, from: prev.from, text: `${prev.text} ${text}` });
    } else out.push({ at: last.sec + 45, from: cur[0].sec, text });
  }
  return out;
}

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

export interface WatchQuestion {
  question: string;
  answer: string;
}

export function questionPrompt(title: string, cp: Checkpoint, asked: string[]): string {
  return [
    `A learner is watching the video "${title}" and has just reached ${clock(cp.at)}. Ask one short question that checks they understood the part they just watched (${clock(cp.from)}–${clock(cp.at)}).`,
    "Ask about the main idea, not a trivial detail or a number they could not remember. Use only what the transcript says. Write in the transcript's language.",
    asked.length ? `Don't repeat these earlier questions:\n${asked.map((q) => `- ${q}`).join("\n")}` : "",
    `Reply with JSON only: {"question": "...", "answer": "a model answer in one or two sentences"}`,
    `TRANSCRIPT\n"""\n${cp.text.slice(0, 12_000)}\n"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseQuestion(reply: string): WatchQuestion | null {
  const o = extractJson<Partial<WatchQuestion>>(reply);
  if (!o || typeof o.question !== "string" || !o.question.trim()) return null;
  return { question: o.question.trim(), answer: typeof o.answer === "string" ? o.answer.trim() : "" };
}

export interface WatchFeedback {
  correct: boolean;
  feedback: string;
}

export function feedbackPrompt(cp: Checkpoint, q: WatchQuestion, given: string): string {
  return [
    "A learner watching a video answered a quick comprehension question. Judge the answer against the transcript. Accept answers in their own words and minor slips; mark it wrong only if the core idea is missing or wrong.",
    'Reply with JSON only: {"correct": true|false, "feedback": "one or two sentences: what was right, and what the video actually said if they missed it"}. Write in the learner\'s language.',
    `QUESTION\n${q.question}`,
    q.answer ? `MODEL ANSWER\n${q.answer}` : "",
    `THEIR ANSWER\n"""\n${given.slice(0, 4000)}\n"""`,
    `TRANSCRIPT\n"""\n${cp.text.slice(0, 12_000)}\n"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseFeedback(reply: string): WatchFeedback | null {
  const o = extractJson<Partial<WatchFeedback>>(reply);
  if (!o || typeof o.correct !== "boolean") return null;
  return { correct: o.correct, feedback: typeof o.feedback === "string" ? o.feedback.trim() : "" };
}
