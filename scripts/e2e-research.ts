/**
 * Live check of YouTube transcripts and deep research with real network + LM Studio.
 * Run: [OPENROUTER_API_KEY=…] bun scripts/e2e-research.ts ["question"]
 */
import { JSDOM } from "jsdom";
import { extractReadable } from "../src/lib/importers/web";
import { fetchTranscript, type HttpFn } from "../src/lib/importers/youtube";
import { deepResearch, writeReport } from "../src/lib/research/deepResearch";
import { createModelSearch } from "../src/lib/research/webSearch";
import { DEFAULT_SEARCH, engines } from "../src/lib/research/search";
import { DEFAULT_RESEARCH_SYSTEM_PROMPT, generateResearchQuery } from "../src/lib/research/prompts";
import { liveModel } from "./lib/liveModel";

const g = globalThis as unknown as { DOMParser: unknown };
g.DOMParser = new JSDOM().window.DOMParser;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const http: HttpFn = async (url, init) => {
  const r = await fetch(url, { method: init.method, headers: { "User-Agent": UA, ...init.headers }, body: init.body });
  return { status: r.status, body: await r.text() };
};


const t0 = Date.now();
const yt = await fetchTranscript("aircAruvnKk", http, ["en"]);
console.log(`youtube: "${yt.title}" ${yt.markdown.length} chars in ${Date.now() - t0} ms`);
console.log(yt.markdown.split("\n").slice(4, 6).join("\n").slice(0, 200));

const llm = liveModel();
const systemPrompt = `${DEFAULT_RESEARCH_SYSTEM_PROMPT}\nFor this run, prefer encyclopedias and university course pages over papers.`;
const suggested = await generateResearchQuery(
  { name: "Biology", sources: [{ title: "Campbell Biology, chapter 9: Cellular respiration" }, { title: "Khan Academy: Photosynthesis overview" }] },
  { llm, systemPrompt },
);
console.log(`suggested question for "Biology": ${suggested}`);

const fetchPage = async (url: string) => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const page = extractReadable(await r.text(), r.url);
  if (!page) throw new Error("no article");
  return { ...page, url: r.url };
};

for (const id of ["duckduckgo", "wikipedia", "arxiv", "openalex", "openstax"] as const) {
  try {
    const r = await engines[id](http, "mitosis phases of cell division");
    console.log(`engine ${id}: ${r.length} results${r[0] ? `, first: ${r[0].url}` : ""}`);
  } catch (e) {
    console.log(`engine ${id}: FAILED ${(e as Error).message}`);
  }
}

const question = process.argv[2] ?? suggested;
const t1 = Date.now();
const rounds = new Set<number>();
const found = await deepResearch(question, {
  llm,
  systemPrompt,
  http,
  fetchPage,
  search: DEFAULT_SEARCH,
  onStage: (st, d, round) => {
    if (round) rounds.add(round);
    console.log(`  [${((Date.now() - t1) / 1000).toFixed(1)}s] r${round ?? "-"} ${st}${d ? `: ${d}` : ""}`);
  },
});
console.log(`research: ${found.length} sources in ${((Date.now() - t1) / 1000).toFixed(1)} s over ${rounds.size} round(s)`);
for (const f of found.slice(0, 8)) console.log(`  ${f.credibility}/${f.relevance}  [${f.engine}] ${f.title}  ${f.url}\n      ${f.summary.slice(0, 140)}`);
console.log(`openstax sources kept: ${found.filter((f) => f.engine === "openstax").length}`);

if (found.length) {
  const report = await writeReport(question, found.slice(0, 5), { llm, systemPrompt });
  console.log(`report: ${report.markdown.length} chars, cited ${JSON.stringify(report.cited)}`);
  console.log(report.markdown.slice(0, 900));
}

const key = process.env.OPENROUTER_API_KEY;
if (key) {
  const provider = { id: "live-openrouter", type: "openrouter", kind: "apiKey", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", config: {}, createdAt: 0 } as const;
  const keyed: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${key}`);
    return fetch(input, { ...init, headers });
  };
  const search = createModelSearch(provider, "deepseek/deepseek-v4.1-flash", { fetch: keyed });
  try {
    const r = await search!(question);
    console.log(`model search (:online): ${r.length} results`);
    for (const x of r.slice(0, 5)) console.log(`  ${x.title}  ${x.url}`);
  } catch (e) {
    console.log(`model search (:online) FAILED: ${(e as Error).message.slice(0, 300)}`);
  }
}
