import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import type { GoalGraph, GoalNode, TopicLevelValue, TopicRef } from "../types";
import { s } from "../strings";
import { languageInstruction } from "../i18n/language";
import type { Curriculum } from "./curricula";
import { generateCustomCurriculum } from "./customCurriculum";

const node = (t: TopicRef, known = false): GoalNode => ({
  id: t.id,
  title: t.title,
  description: t.description,
  group: t.group,
  prereqs: [...(t.prereqs ?? [])],
  known,
  sources: [],
});

/** One graph from any of the three seeds: a bundled curriculum, a pasted syllabus (already parsed to topics), or a proposal. */
export function graphFromTopics(topics: TopicRef[]): GoalGraph {
  return sanitize({ nodes: topics.map((t) => node(t)) });
}

export const graphFromCurriculum = (c: Curriculum): GoalGraph => graphFromTopics(c.topics);

export function toTopicRefs(g: GoalGraph): TopicRef[] {
  return g.nodes.map((n) => ({ id: n.id, title: n.title, description: n.description, group: n.group, prereqs: n.prereqs.length ? n.prereqs : undefined }));
}

export const knownLevels = (g: GoalGraph): { id: string; level: TopicLevelValue }[] => g.nodes.filter((n) => n.known).map((n) => ({ id: n.id, level: "strong" }));

/** Problems that make a graph unusable: empty titles, duplicate ids, unknown or self prerequisites, cycles. */
export function validateGraph(g: GoalGraph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (!n.title.trim()) errors.push(`${n.id}: empty title`);
    if (ids.has(n.id)) errors.push(`${n.id}: duplicate id`);
    ids.add(n.id);
  }
  for (const n of g.nodes) {
    for (const p of n.prereqs) {
      if (p === n.id) errors.push(`${n.id}: depends on itself`);
      else if (!ids.has(p)) errors.push(`${n.id}: unknown prerequisite ${p}`);
    }
  }
  if (errors.length === 0 && findCycle(g)) errors.push("cycle");
  return errors;
}

function findCycle(g: GoalGraph): string[] | null {
  const by = new Map(g.nodes.map((n) => [n.id, n]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const p of by.get(id)?.prereqs ?? []) {
      if (state.get(p) === 1) return [...stack.slice(stack.indexOf(p)), p];
      if (!state.has(p)) {
        const c = visit(p);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const n of g.nodes) if (!state.has(n.id)) {
    const c = visit(n.id);
    if (c) return c;
  }
  return null;
}

/** Drops unknown, self and duplicate prerequisites, then removes the prerequisite edges that close a cycle. */
export function sanitize(g: GoalGraph): GoalGraph {
  const ids = new Set(g.nodes.map((n) => n.id));
  let out: GoalGraph = { nodes: g.nodes.map((n) => ({ ...n, prereqs: [...new Set(n.prereqs)].filter((p) => p !== n.id && ids.has(p)) })) };
  for (let guard = 0; guard < out.nodes.length * out.nodes.length + 1; guard++) {
    const cycle = findCycle(out);
    if (!cycle) break;
    const [from, to] = [cycle[cycle.length - 2], cycle[cycle.length - 1]];
    out = { nodes: out.nodes.map((n) => (n.id === from ? { ...n, prereqs: n.prereqs.filter((p) => p !== to) } : n)) };
  }
  return out;
}

/** Removing a topic hands its prerequisites to the topics that depended on it, so the rest stays connected. */
export function removeNode(g: GoalGraph, id: string): GoalGraph {
  const gone = g.nodes.find((n) => n.id === id);
  if (!gone) return g;
  return sanitize({
    nodes: g.nodes
      .filter((n) => n.id !== id)
      .map((n) => (n.prereqs.includes(id) ? { ...n, prereqs: [...n.prereqs.filter((p) => p !== id), ...gone.prereqs] } : n)),
  });
}

export const renameNode = (g: GoalGraph, id: string, title: string): GoalGraph => ({
  nodes: g.nodes.map((n) => (n.id === id && title.trim() ? { ...n, title: title.trim() } : n)),
});

export const setKnown = (g: GoalGraph, id: string, known: boolean): GoalGraph => ({ nodes: g.nodes.map((n) => (n.id === id ? { ...n, known } : n)) });

/** Prerequisites before the topics that need them; ties keep the original order. */
export function topoOrder(g: GoalGraph): GoalNode[] {
  const placed = new Set<string>();
  const out: GoalNode[] = [];
  while (out.length < g.nodes.length) {
    const next = g.nodes.find((n) => !placed.has(n.id) && n.prereqs.every((p) => placed.has(p))) ?? g.nodes.find((n) => !placed.has(n.id))!;
    placed.add(next.id);
    out.push(next);
  }
  return out;
}

export function proposalPrompt(sentence: string, language?: string | null): string {
  return [
    `A learner wants to learn: "${sentence.slice(0, 400)}".`,
    "Break it into a skill graph of 6 to 16 topics, from fundamentals up. Each topic is one thing a learner can study in a few sessions. Name the prerequisites of each topic by id; a topic with no prerequisites is a starting point. No cycles. Group related topics.",
    languageInstruction(language),
    'Return JSON only: {"title": "short name of the goal", "topics": [{"id": "t1", "title": "…", "description": "a few keywords of what it covers", "group": "…", "prereqs": ["t0"]}]}',
  ].join("\n\n");
}

export function parseProposal(text: string): { title: string | null; graph: GoalGraph } {
  const o = extractJson<{ title?: string; topics?: { id?: unknown; title?: unknown; description?: unknown; group?: unknown; prereqs?: unknown }[] }>(text);
  const raw = (o?.topics ?? []).filter((t) => t && typeof t.title === "string" && t.title.trim()).slice(0, 30);
  if (raw.length < 2) throw new Error(s.failures.couldnTFindATopic);
  const remap = new Map<string, string>();
  raw.forEach((t, i) => remap.set(String(t.id ?? `t${i + 1}`), `goal.${i + 1}`));
  const topics: TopicRef[] = raw.map((t, i) => ({
    id: `goal.${i + 1}`,
    title: String(t.title).trim(),
    description: String(t.description ?? t.title).trim(),
    group: String(t.group ?? "Topics").trim() || "Topics",
    prereqs: (Array.isArray(t.prereqs) ? t.prereqs : []).map((p) => remap.get(String(p))).filter((p): p is string => !!p),
  }));
  return { title: o?.title?.trim() || null, graph: graphFromTopics(topics) };
}

export async function proposeGraph(llm: ResolvedModel, sentence: string, language?: string | null, signal?: AbortSignal) {
  const r = await generateText({ model: llm.model, ...llm.options({ thinking: false }), prompt: proposalPrompt(sentence, language), abortSignal: signal });
  return parseProposal(r.text);
}

/** A pasted syllabus runs through the existing syllabus prompt, then becomes a graph like the others. */
export async function graphFromSyllabus(llm: ResolvedModel, syllabus: string, signal?: AbortSignal) {
  const { title, topics } = await generateCustomCurriculum(llm, syllabus, signal);
  return { title, graph: graphFromTopics(topics) };
}
