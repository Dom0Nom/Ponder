/**
 * Live check of "Where do I start?" micro-steps with a real model.
 * Run: [OPENROUTER_API_KEY=…] bun scripts/e2e-microsteps.ts
 */
import { generateMicroSteps, type MicroStepInput } from "../src/lib/focus/microSteps";
import { liveModel } from "./lib/liveModel";

const cases: MicroStepInput[] = [
  { goal: "Finish chapter 3 practice problems on photosynthesis", spaceName: "Biology", sourceTitles: ["Campbell Biology ch3.pdf", "Photosynthesis notes"] },
  { goal: "Ich muss für die Klausur SQL-Joins lernen", spaceName: "Datenbanken", sourceTitles: ["DB-Skript Kapitel 5.pdf"] },
];
const llm = liveModel();
for (const input of cases) {
  const t = Date.now();
  const steps = await generateMicroSteps(llm, input);
  console.log(`\n"${input.goal}" -> ${steps.length} steps in ${Date.now() - t} ms`);
  steps.forEach((x, i) => console.log(`  ${i + 1}. ${x.text} (~${x.minutes} min)`));
}
