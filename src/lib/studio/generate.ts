import { generateText } from "ai";
import { api } from "../ipc";
import type { ResolvedModel } from "../chat/llm";
import { s } from "../strings";
import type { SearchHit, Source } from "../types";
import { parseOutput, type OutputKind, type Parsed } from "./kinds";
import { outputPrompt, type Material } from "./prompts";

export class NoMaterialError extends Error {}

const PASSAGES = 14;

/** Numbers the sources the passages come from, so a report's [n] markers map back to titles. */
export function buildMaterial(sources: Pick<Source, "id" | "title" | "summary">[], hits: SearchHit[]): Material {
  const order: string[] = [];
  const num = (id: string) => {
    let i = order.indexOf(id);
    if (i < 0) i = order.push(id) - 1;
    return i + 1;
  };
  const passages = hits.map((h) => ({ source: num(h.sourceId), text: h.text.trim() }));
  for (const src of sources) if (src.summary?.trim()) num(src.id);
  const byId = new Map(sources.map((src) => [src.id, src]));
  return {
    sources: order.map((id) => byId.get(id)?.title ?? hits.find((h) => h.sourceId === id)?.sourceTitle ?? "Source"),
    passages,
    summaries: order.flatMap((id, i) => {
      const sum = byId.get(id)?.summary?.trim();
      return sum ? [{ source: i + 1, summary: sum }] : [];
    }),
  };
}

export async function gatherMaterial(spaceId: string, query: string): Promise<Material> {
  const sources = (await api.listSources(spaceId)).filter((src) => src.status === "ready" && src.useInChat);
  if (!sources.length) throw new NoMaterialError();
  const hits = await api.searchChunks(spaceId, query, PASSAGES, sources.map((src) => src.id));
  if (!hits.length) throw new NoMaterialError();
  return buildMaterial(sources.slice(0, 12), hits);
}

/** Generates one output; retries once when the reply doesn't parse. */
export async function generateOutput<K extends OutputKind>(
  llm: ResolvedModel,
  kind: K,
  material: Material,
  focus?: string,
  signal?: AbortSignal,
): Promise<Parsed<K>> {
  const prompt = outputPrompt(kind, material, focus);
  for (let i = 0; i < 2; i++) {
    const r = await generateText({ model: llm.model, prompt, abortSignal: signal, ...llm.options({ thinking: false }) });
    const parsed = parseOutput(kind, r.text);
    if (parsed) {
      if (kind === "report") (parsed.data as { sources: string[] }).sources = material.sources;
      return parsed;
    }
  }
  throw new Error(s.outputs.unreadable);
}
