/**
 * Live check of flashcard generation with a real model.
 * Run: [OPENROUTER_API_KEY=…] bun scripts/e2e-cards.ts
 */
import { generateCards, type Passage } from "../src/lib/srs/generate";
import { expandCloze } from "../src/lib/srs/cloze";
import { liveModel } from "./lib/liveModel";

const texts = [
  "The Calvin cycle takes place in the stroma. It uses ATP and NADPH to fix carbon dioxide from the air into glucose. The enzyme RuBisCO catalyzes the first step of carbon fixation.",
  "Glycolysis happens in the cytoplasm and splits one glucose molecule into two pyruvate molecules, producing a net gain of two ATP.",
  "Eine relationale Datenbank speichert Daten in Tabellen. JOIN verknüpft Tabellen über Fremdschlüssel, GROUP BY fasst Zeilen für Aggregatfunktionen zusammen.",
];
let pos = 0;
const passages: Passage[] = texts.map((text, i) => {
  const p = { sourceId: `s${i}`, sourceTitle: i < 2 ? "Bio notes" : "DB-Skript", text, start: pos, end: pos + text.length };
  pos += text.length + 2;
  return p;
});
const t = Date.now();
const cards = await generateCards(liveModel(), passages, { count: 6 });
console.log(`${cards.length} cards in ${Date.now() - t} ms`);
for (const c of cards.flatMap((x) => expandCloze(x))) {
  const p = passages.find((x) => x.sourceId === c.sourceId)!;
  const quote = p ? texts[passages.indexOf(p)].slice(c.chunkStart! - p.start, c.chunkEnd! - p.start) : "";
  console.log(`- [${c.kind}] ${c.front}${c.back ? ` → ${c.back}` : ""}\n    linked: "${quote.slice(0, 70)}"`);
}
