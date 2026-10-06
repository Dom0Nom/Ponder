/**
 * Live check of placement quiz generation with a real model.
 * Run: [OPENROUTER_API_KEY=…] bun scripts/e2e-quiz.ts
 */
import { CURRICULA } from "../src/lib/placement/curricula";
import { generateQuiz, pickPlacementTopics } from "../src/lib/placement/logic";
import { liveModel } from "./lib/liveModel";

for (const id of ["ged", "ihk-fiae"]) {
  const c = CURRICULA.find((x) => x.id === id)!;
  const topics = pickPlacementTopics(c.topics, 4);
  const t = Date.now();
  const qs = await generateQuiz(liveModel(), { topics, perTopic: 2, language: c.language, purpose: `placement test for ${c.title}` });
  console.log(`\n== ${c.title}: ${qs.length} questions in ${Date.now() - t} ms (topics: ${topics.map((x) => x.id).join(", ")})`);
  for (const q of qs.slice(0, 4)) console.log(`  [${q.topicId}] ${q.question}\n     ✓ ${q.options[q.answer]}   (${q.options.length} options)`);
  const missing = topics.filter((tp) => !qs.some((q) => q.topicId === tp.id));
  if (missing.length) console.log(`  !! no questions for ${missing.map((m) => m.id).join(", ")}`);
}
