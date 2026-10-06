/**
 * Live check of the math step checker and photo transcription.
 * Run: OPENROUTER_API_KEY=… bun scripts/e2e-steps.ts   (VISION_MODEL=… to pick the vision model)
 */
import { chromium } from "@playwright/test";
import { checkSteps, type StepCheckResult } from "../src/lib/steps/check";
import { transcribeSteps } from "../src/lib/steps/vision";
import { liveModel, liveVisionModel } from "./lib/liveModel";

const problem = "Solve 2(x-3)+4=10";
const key = process.env.OPENROUTER_API_KEY;

async function spent(): Promise<number | null> {
  if (!key) return null;
  const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
  const j = (await r.json().catch(() => null)) as { data?: { usage?: number } } | null;
  return j?.data?.usage ?? null;
}

function show(label: string, steps: string[], r: StepCheckResult, ms: number) {
  console.log(`\n${label} (${ms} ms): firstWrong=${r.firstWrong == null ? "none" : `step ${r.firstWrong + 1}`} finalCorrect=${r.finalCorrect}`);
  console.log(`  summary: ${r.summary}`);
  for (const v of r.verdicts) {
    console.log(`  ${v.ok ? "✓" : "✗"} ${steps[v.index]}  [${v.checkedBy}]${v.issue ? `\n      issue: ${v.issue}` : ""}${v.hint ? `\n      hint: ${v.hint}` : ""}${v.fix ? `\n      fix: ${v.fix}` : ""}`);
  }
}

/** Renders handwriting-style work to a PNG with the system's handwriting fonts. */
async function handwrittenPng(lines: string[]): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 620, height: 80 + lines.length * 64 } });
    const rows = lines
      .map((l, i) => `<div style="transform: rotate(${((i % 3) - 1) * 0.8}deg) translateX(${(i % 2) * 14}px)">${l}</div>`)
      .join("");
    await page.setContent(
      `<body style="margin:0;padding:28px 40px;background:#fdfcf6;color:#1d2a6b;font:44px 'Bradley Hand','Noteworthy','Marker Felt',cursive;line-height:64px">${rows}</body>`,
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

const before = await spent();
const llm = liveModel();
console.log(`text model: ${llm.modelId}`);

const correct = ["2x-6+4=10", "2x-2=10", "2x=12", "x=6"];
let t = Date.now();
show("Correct solution", correct, await checkSteps(llm, { problem, steps: correct }), Date.now() - t);

const wrong = ["2x-3+4=10", "2x+1=10", "2x=9", "x=4.5"];
t = Date.now();
show("Wrong solution (distribution error in step 1)", wrong, await checkSteps(llm, { problem, steps: wrong, expectedAnswer: "6" }), Date.now() - t);

const vision = liveVisionModel();
console.log(`\nvision model: ${vision.modelId}`);
const png = await handwrittenPng(["2(x − 3) + 4 = 10", "2x − 6 + 4 = 10", "2x − 2 = 10", "2x = 8", "x = 4"]);
await Bun.write(`${process.env.TMPDIR ?? "/tmp"}/e2e-steps-work.png`, png);
t = Date.now();
const tr = await transcribeSteps(vision, { data: new Uint8Array(png), mediaType: "image/png" });
console.log(`transcribed (${Date.now() - t} ms): problem=${JSON.stringify(tr.problem)} steps=${JSON.stringify(tr.steps)}`);
const photoSteps = tr.steps.filter((x) => x.replace(/\s/g, "") !== "2(x-3)+4=10");
t = Date.now();
show("Photo solution (2x=8 is wrong)", photoSteps, await checkSteps(llm, { problem: tr.problem || problem, steps: photoSteps }), Date.now() - t);

const after = await spent();
if (before != null && after != null) console.log(`\nOpenRouter spend for this run: $${(after - before).toFixed(5)}`);
