/** Canned model replies for the glossary, reading-level rewrites and translations, keyed by the prompt's first line. */
const TERMS: [string, string][] = [
  ["photosynthesis", "How plants turn light into chemical energy."],
  ["chlorophyll", "The green pigment that absorbs light."],
  ["calvin cycle", "The stage that fixes carbon dioxide into sugar."],
  ["chloroplasts", "The cell parts where photosynthesis happens."],
  ["atp", "The molecule that carries energy in cells."],
  ["mitochondria", "The cell parts that make ATP."],
];

const block = (prompt: string, label: string) => prompt.match(new RegExp(`${label}:\\n"""\\n([\\s\\S]*?)\\n"""`))?.[1] ?? "";

export function notesReply(prompt: string): string | null {
  if (/^Extract a glossary of the key terms/.test(prompt)) {
    const text = block(prompt, "TEXT").toLowerCase();
    const found = TERMS.filter(([t]) => text.includes(t));
    const word = text.match(/[a-z]{7,}/)?.[0];
    const terms = found.length
      ? found.map(([t, d]) => ({ term: t.charAt(0).toUpperCase() + t.slice(1), definition: d }))
      : word
        ? [{ term: word, definition: "A word used in the text." }]
        : [];
    return JSON.stringify({ terms });
  }
  if (/^Rewrite the passage below at a simpler/.test(prompt)) return `In simple words: ${block(prompt, "PASSAGE")}`;
  if (/^Rewrite the passage below at a more advanced/.test(prompt)) return `In technical terms: ${block(prompt, "PASSAGE")}`;
  const tr = prompt.match(/^Translate the passage below into (\w+)/);
  if (tr) return `[${tr[1]}] ${block(prompt, "PASSAGE")}`;
  return null;
}
