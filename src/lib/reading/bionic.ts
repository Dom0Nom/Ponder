export type BionicSegment = { text: string; bold: boolean };

const TOKEN = /(https?:\/\/\S+|www\.\S+)|([\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*)/gu;
const HAS_DIGIT = /\p{N}/u;
const MARK = /^\p{M}$/u;
const SKIP = /^[\p{M}'’]$/u;

function boldLength(letters: string[]): number {
  const n = letters.filter((c) => !SKIP.test(c)).length;
  const target = n <= 3 ? 1 : Math.ceil(n / 2);
  let count = 0;
  let i = 0;
  while (i < letters.length && count < target) {
    if (!SKIP.test(letters[i])) count++;
    i++;
  }
  while (i < letters.length && MARK.test(letters[i])) i++;
  return letters.slice(0, i).join("").length;
}

/** Splits text into segments (concatenating them gives the input back) with the first part of each word marked bold. */
export function bionicSegments(text: string): BionicSegment[] {
  const out: BionicSegment[] = [];
  const push = (t: string, bold: boolean) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.bold === bold) last.text += t;
    else out.push({ text: t, bold });
  };
  let pos = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    push(text.slice(pos, start), false);
    pos = start + m[0].length;
    const word = m[2];
    if (!word || HAS_DIGIT.test(word)) {
      push(m[0], false);
      continue;
    }
    const cut = boldLength(Array.from(word));
    push(word.slice(0, cut), true);
    push(word.slice(cut), false);
  }
  push(text.slice(pos), false);
  return out;
}
