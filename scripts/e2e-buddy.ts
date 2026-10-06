/**
 * Live check of the low-energy study-buddy instructions (session start, block quiz).
 * Run: OPENROUTER_API_KEY=… bun scripts/e2e-buddy.ts
 */
import { streamText } from "ai";
import { buddyInstruction } from "../src/lib/buddy/prompts";
import { buildSystemPrompt, describeFocus } from "../src/lib/chat/context";
import type { FocusState } from "../src/lib/types";
import { liveModel } from "./lib/liveModel";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY (this script doesn't use LM Studio).");

const MIN = 60_000;
const state: FocusState = {
  sessionId: "s",
  spaceId: "sp",
  technique: "pomodoro",
  goal: "Review photosynthesis",
  phase: "work",
  block: 1,
  phaseStartedAt: 0,
  phaseDurationMs: 25 * MIN,
  elapsedMs: 0,
  remainingMs: 25 * MIN,
  paused: false,
  pauseReason: null,
  pauseCount: 0,
  needAppCount: 0,
  totalFocusMs: 0,
  totalBreakMs: 0,
  checkInMins: 15,
  energy: "low",
  now: 0,
};

const passage = "The Calvin cycle takes place in the stroma. It uses ATP and NADPH to fix carbon dioxide into glucose.";
const llm = liveModel();

async function run(label: string, kind: "session-start" | "block-quiz", s: FocusState) {
  const system = buildSystemPrompt({
    space: { name: "Biology", strictGrounding: false },
    tutorStyle: "direct",
    passages: [{ n: 1, sourceTitle: "Cell Biology Basics", page: 1, text: passage }],
    focus: s,
    now: Date.now(),
    sourceCount: 1,
  });
  const instruction = buddyInstruction(kind, { state: s, previous: s, parking: [], needAppPauses: 0 });
  const r = streamText({ model: llm.model, system, prompt: instruction, ...llm.options({ thinking: false }) });
  let text = "";
  for await (const p of r.stream) if (p.type === "text-delta") text += p.text;
  console.log(`\n== ${label} (${llm.modelId}, ${text.trim().split(/\s+/).length} words)\n${text.trim()}`);
}

console.log(describeFocus(state, Date.now()));
await run("low-energy session start", "session-start", state);
await run("low-energy block quiz", "block-quiz", { ...state, phase: "break", elapsedMs: 0, remainingMs: 5 * MIN, phaseDurationMs: 5 * MIN });
