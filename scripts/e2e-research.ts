/**
 * Live check of YouTube transcripts and deep research with real network + LM Studio.
 * Run: [OPENROUTER_API_KEY=…] bun scripts/e2e-research.ts ["question"]
 */
import { JSDOM } from "jsdom";
import { extractReadable } from "../src/lib/importers/web";
import { fetchTranscript, type HttpFn } from "../src/lib/importers/youtube";
import { deepResearch } from "../src/lib/research/deepResearch";
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

const question = process.argv[2] ?? suggested;
const t1 = Date.now();
const found = await deepResearch(question, {
  llm,
  systemPrompt,
  http,
  fetchPage: async (url) => {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const page = extractReadable(await r.text(), r.url);
    if (!page) throw new Error("no article");
    return { ...page, url: r.url };
  },
  onStage: (st, d) => console.log(`  [${((Date.now() - t1) / 1000).toFixed(1)}s] ${st}${d ? `: ${d}` : ""}`),
});
console.log(`research: ${found.length} sources in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
for (const f of found.slice(0, 8)) console.log(`  ${f.credibility}/${f.relevance}  ${f.title}  ${f.url}\n      ${f.summary.slice(0, 140)}`);
