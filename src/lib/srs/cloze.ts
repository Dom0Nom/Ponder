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

/** One card per gap number, so "{{c1::…}} … {{c2::…}}" tests each gap on its own. */
export function expandCloze<T extends { kind: string; front: string; data?: { cloze?: number } | null }>(card: T): T[] {
  if (card.kind !== "cloze") return [card];
  const nums = clozeNumbers(card.front);
  return (nums.length ? nums : [1]).map((n) => ({ ...card, data: { ...(card.data ?? {}), cloze: n } }));
}

/** The sentence around [start, end) in a text, with that span turned into gap c1. */
export function clozeFromSelection(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const sStart = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("? "), before.lastIndexOf("! ")) + 1;
  const rest = text.slice(end);
  const m = rest.search(/[.!?](\s|$)|\n/);
  const sEnd = m === -1 ? text.length : end + m + 1;
  const sentence = text.slice(sStart, sEnd).trim();
  const sel = text.slice(start, end);
  const i = sentence.indexOf(sel);
  return i === -1 ? `{{c1::${sel}}}` : `${sentence.slice(0, i)}{{c1::${sel}}}${sentence.slice(i + sel.length)}`;
}
