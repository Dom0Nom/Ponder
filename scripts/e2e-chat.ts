/**
 * Live check of a grounded chat turn, self-check and second opinion with real models.
 * Run: OPENROUTER_API_KEY=… bun scripts/e2e-chat.ts   (falls back to LM Studio without a key)
 */
import { generateText, streamText } from "ai";
import { buildSystemPrompt } from "../src/lib/chat/context";
import { citedNumbers, inferCitations, splitSegments } from "../src/lib/chat/citations";
import { extractFollowUps } from "../src/lib/chat/followUps";
import { extractMemories } from "../src/lib/chat/memory";
import { selfCheck } from "../src/lib/chat/selfCheck";
import type { Citation } from "../src/lib/types";
import { liveModel } from "./lib/liveModel";

const passages = [
  "The Calvin cycle takes place in the stroma. It uses ATP and NADPH to fix carbon dioxide from the air into glucose. The enzyme RuBisCO catalyzes the first step of carbon fixation.",
  "Glycolysis happens in the cytoplasm and splits one glucose molecule into two pyruvate molecules, producing a net gain of two ATP.",
  "The citric acid cycle and the electron transport chain take place in the mitochondria. Oxidative phosphorylation produces roughly 30 to 32 ATP per glucose.",
];
const citations: Citation[] = passages.map((text, i) => ({
  n: i + 1, chunkId: i + 1, sourceId: "s", sourceTitle: "Cell Biology Basics", start: 0, end: text.length, page: 1, snippet: text, text,
}));

async function turn(label: string, modelId: string | undefined, question: string) {
  const llm = liveModel(modelId);
  const system = buildSystemPrompt({
    space: { name: "Biology", strictGrounding: false },
    tutorStyle: "direct",
    passages: citations.map((c) => ({ n: c.n, sourceTitle: c.sourceTitle, page: c.page, text: c.text! })),
    focus: null,
    now: Date.now(),
    sourceCount: 1,
    memory: ["Is preparing for the GED science test"],
  });
  const t = Date.now();
  const r = streamText({ model: llm.model, system, prompt: question, ...llm.options({ thinking: false }) });
  let text = "";
  for await (const p of r.stream) if (p.type === "text-delta") text += p.text;
  const fu = extractFollowUps(text);
  const { clean, memories } = extractMemories(fu.clean);
  const shown = inferCitations(clean, citations.map((c) => ({ n: c.n, text: c.text! })));
  const kinds = splitSegments(shown, { hadSources: true, known: 3 }).map((s) => s.kind);
  console.log(`\n== ${label} (${llm.modelId}, ${Date.now() - t} ms)\n${clean}\n-- cited: [${citedNumbers(clean, 3)}] after matching: [${citedNumbers(shown, 3)}] segments: ${kinds.join(",")} memories: ${JSON.stringify(memories)}\n-- follow-ups (${fu.followUps.length}): ${JSON.stringify(fu.followUps)}${/\{\{\s*follow/i.test(clean) ? "   !! marker left in text" : ""}`);
  return clean;
}

const answer = await turn("grounded answer", undefined, "I'm studying for my GED in March and I get confused easily. Where does the Calvin cycle happen and how much ATP does glycolysis make? Also, why are leaves green?");
const check = await selfCheck(answer, citations, liveModel());
console.log("\n== self-check");
for (const i of check.items) console.log(`  ${i.verdict.padEnd(12)} [${i.passages}] ${i.claim}${i.note ? ` (${i.note})` : ""}`);
await turn("second opinion", "anthropic/claude-haiku-4.5", "I'm studying for my GED in March and I get confused easily. Where does the Calvin cycle happen and how much ATP does glycolysis make? Also, why are leaves green?");

const { text: jsonish } = await generateText({ model: liveModel().model, prompt: 'Return JSON only: {"queries": ["a", "b"]}', ...liveModel().options({ thinking: false }) });
console.log(`\n== json reply: ${jsonish.slice(0, 80)}`);
