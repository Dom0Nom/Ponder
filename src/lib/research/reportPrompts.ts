export interface GapSource {
  title: string;
  summary: string;
}

export interface Gaps {
  gaps: string[];
  queries: string[];
}

/** Round 2+: what the kept sources don't cover yet, as new search queries. */
export function gapPrompt(question: string, kept: GapSource[], searched: string[]): string {
  const sources = kept.length ? kept.slice(0, 12).map((k, i) => `[${i + 1}] ${k.title}: ${k.summary.slice(0, 220)}`).join("\n") : "(none kept yet)";
  return `Find what a learner's collected sources still don't cover so the app can search for it; your reply is read by the app's parser.

QUESTION:
"""
${question}
"""

SOURCES KEPT SO FAR:
${sources}

QUERIES ALREADY SEARCHED:
${searched.map((q) => `- ${q}`).join("\n")}

Rules:
- A gap is a part of the question that no kept source teaches, judged from the summaries. Name at most 3 gaps, each under 12 words.
- For each gap write one web search query of 2 to 8 words that would find a page teaching it. A query already searched finds the same pages again, so write a different one.
- Write gaps and queries in the language of the question. If that isn't English, English queries are fine when they find better material.
- If the sources already cover the question, return empty lists; more searching would only add repeats.
- If no sources were kept, treat the whole question as the gap and phrase the queries differently from those already searched.

Return JSON only: {"gaps": ["how the process is regulated"], "queries": ["cell cycle checkpoints regulation"]}`;
}

export function parseGaps(parsed: unknown, searched: string[] = []): Gaps {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as { gaps?: unknown; queries?: unknown };
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
  const used = new Set(searched.map((q) => q.toLowerCase()));
  const queries = [...new Set(strings(o.queries).map((q) => q.slice(0, 120)))].filter((q) => !used.has(q.toLowerCase())).slice(0, 3);
  const gaps = strings(o.gaps).slice(0, 3);
  return { gaps: queries.length ? gaps : [], queries };
}

export interface ReportSource {
  title: string;
  url: string;
  markdown: string;
}

export const REPORT_CHARS_PER_SOURCE = 5000;
export const REPORT_CHARS_TOTAL = 60000;

export function reportPrompt(question: string, sources: ReportSource[]): string {
  const each = Math.min(REPORT_CHARS_PER_SOURCE, Math.floor(REPORT_CHARS_TOTAL / Math.max(1, sources.length)));
  const docs = sources
    .map((s, i) => `<source n="${i + 1}" title="${s.title.replace(/"/g, "'")}" url="${s.url}">\n${s.markdown.slice(0, each)}\n</source>`)
    .join("\n");
  return `Write a short study report for a learner that answers their question using only the numbered sources below.

${docs}

QUESTION:
"""
${question}
"""

Rules:
- Put a citation like [2] right after each claim it supports. Cite only source numbers that appear above; the learner opens the numbered list to check them, so an invented number sends them nowhere. For several sources write [1][3].
- Use only what the sources say. Leave out anything they don't contain instead of filling it in from memory.
- Format: a "# " title, then 3 to 6 short sections with "## " headings, under 700 words, in plain language for someone learning the topic. Explain terms where they first appear.
- Do not write a source list; the app adds it.
- The last section is "## Not covered": which parts of the question the sources don't answer, or "Nothing important" if they cover it all.
- If the sources don't answer the question at all, say so in two sentences and suggest what to search for instead.
- Write in the language of the question. Quote at most a short phrase from any source.

Return the Markdown report only.`;
}

export interface FinishedReport {
  markdown: string;
  /** source numbers that are actually cited in the text */
  cited: number[];
}

const SOURCE_HEADING = /\n#{1,4}[ \t]*(?:sources?|references?|bibliography|quellen(?:verzeichnis)?|sources? list)[ \t]*:?[ \t]*\n[\s\S]*$/i;

/** Keeps citations that point at real sources, removes a source list the model wrote anyway, appends the numbered list. */
export function finishReport(text: string, sources: { title: string; url: string }[]): FinishedReport {
  let body = text.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, "$1").trim();
  body = `\n${body}`.replace(SOURCE_HEADING, "").trim();
  body = body.replace(/\[(\d+(?:\s*[,;]\s*\d+)+)\]/g, (_, list: string) =>
    list
      .split(/\s*[,;]\s*/)
      .map((n) => `[${n}]`)
      .join(""),
  );
  const cited = new Set<number>();
  body = body
    .replace(/[ \t]*\[(\d+)\]/g, (m, n: string) => {
      const k = Number(n);
      if (k < 1 || k > sources.length) return "";
      cited.add(k);
      return m;
    })
    .replace(/[ \t]+([.,;:!?])/g, "$1");
  const list = sources.map((s, i) => `- [${i + 1}] ${s.title.replace(/\s+/g, " ").trim()} — ${s.url}`).join("\n");
  return { markdown: `${body}\n\n## Sources\n\n${list}\n`, cited: [...cited].sort((a, b) => a - b) };
}

/** Asks a search-capable model for pages on a topic; the app reads the cited URLs, not the text. */
export function modelSearchPrompt(query: string): string {
  return `Search the web for free, trustworthy study material on a topic; the app reads only the pages you cite, not your text.

TOPIC:
"""
${query}
"""

Find up to 5 pages that teach this: textbooks, encyclopedias, university course pages or peer-reviewed papers. Skip forums, content farms and paywalled pages. Cite every page you use. Reply with one line per page: its title and what it teaches.`;
}
