/**
 * Token counts with the o200k BPE (GPT-4o/GPT-5 family). Other model families tokenize within
 * about ±15% of it; budgets keep a margin for that. Until the tokenizer has loaded, a per-script
 * estimate stands in.
 */
type Counter = (text: string) => number;

let exact: Counter | null = null;
let loading: Promise<void> | null = null;

export function loadTokenizer(): Promise<void> {
  loading ??= import("gpt-tokenizer/encoding/o200k_base")
    .then((m) => {
      exact = m.countTokens;
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

const WIDE = /[぀-ヿ㐀-鿿가-힯豈-﫿]/g;
const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-ۿऀ-෿฀-๿]/g;

/** Rough count from character classes: CJK ≈ 1 token per char, other scripts ≈ 2.5, Latin ≈ 4. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const wide = text.match(WIDE)?.length ?? 0;
  const other = text.match(NON_LATIN)?.length ?? 0;
  const rest = text.length - wide - other;
  return Math.ceil(wide + other / 2.5 + rest / 4);
}

const SAMPLE = 6000;

/** Exact for short text; long text is sampled at three places and scaled. */
export function countTokens(text: string): number {
  if (!text) return 0;
  if (!exact) {
    void loadTokenizer();
    return estimateTokens(text);
  }
  if (text.length <= SAMPLE * 4) return exact(text);
  const mid = Math.floor(text.length / 2 - SAMPLE / 2);
  const parts = [text.slice(0, SAMPLE), text.slice(mid, mid + SAMPLE), text.slice(-SAMPLE)];
  const tokens = parts.reduce((n, p) => n + exact!(p), 0);
  return Math.ceil((tokens / (SAMPLE * 3)) * text.length);
}

/** Tokens of a chat message including the role/format overhead most APIs add. */
export const messageTokens = (content: string) => countTokens(content) + 4;

/** Longest prefix of `text` that fits `tokens`, cut at a paragraph or sentence end when one is near. */
export function truncateToTokens(text: string, tokens: number): { text: string; truncated: boolean } {
  if (tokens <= 0) return { text: "", truncated: text.length > 0 };
  const total = countTokens(text);
  if (total <= tokens) return { text, truncated: false };
  let cut = Math.floor((text.length * tokens) / total);
  while (cut > 0 && countTokens(text.slice(0, cut)) > tokens) cut = Math.floor(cut * 0.95);
  const slice = text.slice(0, cut);
  const para = slice.lastIndexOf("\n\n");
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"));
  const end = para > cut * 0.8 ? para : sentence > cut * 0.5 ? sentence + 1 : cut;
  return { text: slice.slice(0, end), truncated: true };
}
