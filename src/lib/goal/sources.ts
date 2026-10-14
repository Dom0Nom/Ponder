import { api } from "../ipc";
import { proxyHttp } from "../importers/http";
import { resolveResearch, resolveSearchConfig } from "../research/config";
import { deepResearch, type FoundSource } from "../research/deepResearch";
import type { GoalNode, GoalSource, Space } from "../types";

const FREE_HOSTS = [
  /(^|\.)openstax\.org$/,
  /(^|\.)ocw\.mit\.edu$/,
  /(^|\.)khanacademy\.org$/,
  /(^|\.)wikibooks\.org$/,
  /(^|\.)wikipedia\.org$/,
  /(^|\.)libretexts\.org$/,
  /(^|\.)developer\.mozilla\.org$/,
  /(^|\.)readthedocs\.(io|org)$/,
  /(^|\.)edx\.org$/,
  /(^|\.)coursera\.org$/,
  /(^|\.)arxiv\.org$/,
  /\.edu$/,
  /^docs\./,
];

export function isFreeMaterial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return FREE_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

/** Relevance and credibility from the ranker, plus a boost for free educational material. */
export function pickSources(found: FoundSource[], max = 3): GoalSource[] {
  const score = (f: FoundSource) => f.relevance + f.credibility * 0.5 + (isFreeMaterial(f.url) ? 30 : 0);
  return [...found]
    .sort((a, b) => score(b) - score(a))
    .slice(0, max)
    .map((f) => ({ title: f.title, url: f.url, summary: f.summary, free: isFreeMaterial(f.url) }));
}

export function sourceQuery(goalTitle: string, node: Pick<GoalNode, "title" | "description">): string {
  return `${node.title} (${node.description}) for ${goalTitle}: free textbook or course, for example OpenStax, MIT OpenCourseWare or official documentation`;
}

export async function findTopicSources(space: Space, goalTitle: string, node: GoalNode, signal?: AbortSignal): Promise<GoalSource[]> {
  const [{ llm, systemPrompt }, settings, existing] = await Promise.all([resolveResearch(space), api.getSettings(), api.listSources(space.id)]);
  const search = await resolveSearchConfig(settings, llm, signal);
  const found = await deepResearch(sourceQuery(goalTitle, node), {
    llm,
    systemPrompt,
    http: proxyHttp,
    signal,
    search,
    maxRounds: 1,
    skipUrls: existing.map((x) => x.origin).filter((o): o is string => !!o),
  });
  return pickSources(found);
}
