const GAP = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;

/** Gap numbers used in a cloze note, ascending. */
export function clozeNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(GAP)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/** Question side: the tested gap shows "[…]" (or its hint); other gaps show their answers. */
export function clozeFront(text: string, n: number): string {
  return text.replace(GAP, (_, num: string, answer: string, hint?: string) =>
    Number(num) === n ? `[${hint ? hint : "…"}]` : answer,
  );
}

/** Answer side: the tested gap is bold. */
export function clozeBack(text: string, n: number): string {
  return text.replace(GAP, (_, num: string, answer: string) => (Number(num) === n ? `**${answer}**` : answer));
}

/** Wraps the selected words of a note in the next free gap number. */
export function addGap(text: string, start: number, end: number): string {
  if (end <= start) return text;
  const next = (clozeNumbers(text).at(-1) ?? 0) + 1;
  return `${text.slice(0, start)}{{c${next}::${text.slice(start, end)}}}${text.slice(end)}`;
}
