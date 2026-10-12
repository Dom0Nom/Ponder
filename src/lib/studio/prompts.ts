import type { OutputKind } from "./kinds";

export interface Material {
  /** Source titles; passages refer to them by 1-based number. */
  sources: string[];
  passages: { source: number; text: string }[];
  summaries: { source: number; summary: string }[];
}

const NOUN: Record<OutputKind, string> = {
  report: "study report",
  cheatsheet: "one-page cheat sheet",
  worksheet: "printable worksheet with an answer key",
  timeline: "timeline",
  table: "data table",
  mindmap: "mind map",
  diagram: "Mermaid diagram",
  slides: "slide deck",
  infographic: "one-page infographic",
};

const TASK: Record<OutputKind, string[]> = {
  report: [
    "Write a structured report in Markdown, 400–700 words, or shorter when the material is short (never repeat a fact or pad to reach a length): a one-paragraph overview, then 3–5 `##` sections, then `## Key takeaways` with 3–5 bullets.",
    "Cite the material with [n] markers right after the sentence they support, where n is a source number from SOURCES. Every section has at least one citation. Only use numbers that exist in SOURCES.",
    "Leave out anything the material doesn't support; the learner trusts this report as a summary of their own sources.",
  ],
  cheatsheet: [
    "Write a dense one-page cheat sheet in Markdown: 4–7 `##` sections with short bullets, key terms in **bold**, formulas in $…$ LaTeX, and at most 350 words.",
    "Prefer definitions, formulas, rules, dates and common mistakes over explanation; the learner uses it for last-minute review.",
  ],
  worksheet: [
    "Write 8–12 questions that check understanding of the material, easiest first. Mix kinds: \"short\" (one-sentence answer), \"fill\" (a sentence with ____ for one missing term), \"choice\" (4 options).",
    "Every answer must be stated or directly derivable from the material. For \"choice\", answer is the exact text of the correct option.",
    "instructions is one sentence telling the learner how to work through the sheet.",
  ],
  timeline: [
    "Pick one axis: history (dates or years) or a process (date is \"Step 1\", \"Step 2\"…), whichever covers more of the material. Never mix them: a process timeline has no years, a history timeline has no steps.",
    "List 6–15 events in chronological order, fewer if the chosen axis has fewer. date is as precise as the material allows (a year, a date, or a stage like \"Step 1\" when the material describes a process rather than history).",
    "title is at most 8 words; detail is one sentence on why the event matters.",
  ],
  table: [
    "Build one comparison table: 3–6 columns, 4–15 rows (fewer only if the material has fewer such items). Every row is the same type of item (stages, people, terms, events…); pick the comparison the material supports best and leave out facts that don't fit it. The first column names the items being compared.",
    "Cells are short (a number, a term, or a few words). Use an empty string when the material has no value for a cell rather than guessing.",
    "caption is one sentence saying what the table compares.",
  ],
  mindmap: [
    "Build a mind map: root.label is the central topic, 3–7 main branches, each with 2–5 children, at most 3 levels below the root.",
    "Labels are 1–5 words, never full sentences.",
  ],
  diagram: [
    "Draw the material's main process, structure or relationships as one Mermaid diagram. Use `flowchart TD` unless a sequence, state, class or ER diagram fits clearly better.",
    "8–20 nodes. Node ids are plain letters/digits (A, B1); put the text in brackets and wrap any label with punctuation in quotes, e.g. A[\"Light reactions (thylakoid)\"]. No styling, no comments, no HTML.",
    "code is the Mermaid source only, without a ``` fence.",
  ],
  slides: [
    "Write a 6–10 slide deck: a title slide (bullets empty), content slides with 3–5 bullets of at most 12 words each, and a summary slide last.",
    "notes are 2–3 sentences of speaker notes per slide that explain what the bullets only name.",
  ],
  infographic: [
    "Plan a one-page infographic: subtitle is one sentence, 2–4 stats (a short value like \"70%\", \"1865\" or \"3 stages\" and a label of at most 6 words) taken from the material, 3–4 sections with a 1–4 word heading and 2–4 points of at most 12 words, and a one-sentence takeaway.",
    "Only use numbers that appear in the material; if it has fewer than 2 numbers, use counts of things it lists (\"4 phases\").",
  ],
};

const SHAPE: Record<OutputKind, string> = {
  report: '{"title": "…", "markdown": "…"}',
  cheatsheet: '{"title": "…", "markdown": "…"}',
  worksheet: '{"title": "…", "instructions": "…", "questions": [{"q": "…", "kind": "short", "answer": "…"}, {"q": "…", "kind": "choice", "options": ["…", "…", "…", "…"], "answer": "…"}, {"q": "The ____ …", "kind": "fill", "answer": "…"}]}',
  timeline: '{"title": "…", "events": [{"date": "…", "title": "…", "detail": "…"}]}',
  table: '{"title": "…", "caption": "…", "columns": ["…", "…"], "rows": [["…", "…"]]}',
  mindmap: '{"title": "…", "root": {"label": "…", "children": [{"label": "…", "children": [{"label": "…", "children": []}]}]}}',
  diagram: '{"title": "…", "code": "flowchart TD\\n  A[\\"…\\"] --> B[\\"…\\"]"}',
  slides: '{"title": "…", "slides": [{"title": "…", "bullets": ["…"], "notes": "…"}]}',
  infographic: '{"title": "…", "subtitle": "…", "stats": [{"value": "…", "label": "…"}], "sections": [{"heading": "…", "points": ["…"]}], "takeaway": "…"}',
};

/** First line is stable per kind: the mock backend and the eval harness match it. */
export function outputPrompt(kind: OutputKind, m: Material, focus?: string): string {
  const sources = m.sources.map((t, i) => `[${i + 1}] ${t}`).join("\n");
  const summaries = m.summaries.map((x) => `[${x.source}] ${x.summary}`).join("\n\n");
  const passages = m.passages.map((p) => `[${p.source}] ${p.text}`).join("\n\n");
  return [
    `Create a ${NOUN[kind]} for a learner from their own study material.`,
    `SOURCES\n${sources}`,
    summaries ? `SUMMARIES\n"""\n${summaries}\n"""` : "",
    `PASSAGES (each starts with its source number)\n"""\n${passages}\n"""`,
    focus?.trim() ? `Focus on: ${focus.trim()}. Leave out material that doesn't relate to it.` : "Cover the material's most important ideas.",
    ...TASK[kind],
    "Use only facts from the material above. Write in the same language as the material, including the title; keep technical terms as the material spells them.",
    "title is at most 8 words.",
    `Return JSON only:\n${SHAPE[kind]}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const outputPromptStart = (kind: OutputKind) => `Create a ${NOUN[kind]} for a learner`;
