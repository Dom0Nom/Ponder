/**
 * Live check of adaptive practice generation, grading and error classification.
 * Run: [OPENROUTER_API_KEY=…] bun scripts/e2e-practice.ts
 */
import { CURRICULA } from "../src/lib/placement/curricula";
import { classifyError, generateProblem, generateVariation, gradeResponse } from "../src/lib/practice/problems";
import { levelFor } from "../src/lib/practice/irt";
import type { PracticeItem } from "../src/lib/types";
import { liveModel } from "./lib/liveModel";

const llm = liveModel();
const asItem = (x: Omit<PracticeItem, "id" | "createdAt">, i: number): PracticeItem => ({ ...x, id: `i${i}`, createdAt: 0 });

for (const [cid, match] of [["ged", /percent/i], ["ihk-fiae", /subnet|IP/i]] as const) {
  const c = CURRICULA.find((x) => x.id === cid)!;
  const t = c.topics.find((x) => match.test(x.title) || match.test(x.description)) ?? c.topics[0];
  const topic = { key: t.id, title: t.title, description: t.description };
  console.log(`\n== ${c.title} / ${t.title}`);
  const seen: string[] = [];
  for (const level of [1, 3, 5]) {
    const start = Date.now();
    const p = asItem(await generateProblem(llm, { topic, level, avoid: seen, language: c.language }), level);
    seen.push(p.question);
    console.log(`  L${level}→${levelFor(p.difficulty)} ${p.kind} (${Date.now() - start} ms): ${p.question.replace(/\s+/g, " ").slice(0, 400)}`);
    console.log(`     answer: ${p.kind === "mcq" ? p.options![Number(p.answer)] : p.answer}`);
    const right = p.kind === "mcq" ? p.answer : p.answer;
    const wrong = p.kind === "mcq" ? String((Number(p.answer) + 1) % p.options!.length) : p.kind === "numeric" ? String(Number(p.answer.replace(",", ".")) + 7) : "I don't know";
    const g1 = await gradeResponse(llm, p, right);
    const g2 = await gradeResponse(llm, p, wrong);
    console.log(`     grade right=${g1.correct} wrong=${g2.correct}${g1.correct && !g2.correct ? "" : "   !! grading mismatch"}`);
    if (level === 3) {
      const c2 = await classifyError(llm, { question: p.question, answer: p.kind === "mcq" ? p.options![Number(p.answer)] : p.answer, solution: p.solution }, p.kind === "mcq" ? p.options![Number(wrong)] : wrong);
      console.log(`     error type for "${wrong}": ${c2.errorType} — ${c2.note}`);
      for (const mode of ["easier", "harder"] as const) {
        const v = await generateVariation(llm, p, mode);
        console.log(`     ${mode} → L${levelFor(v.difficulty)} ${v.kind}: ${v.question.replace(/\s+/g, " ").slice(0, 140)}`);
      }
    }
  }
}
