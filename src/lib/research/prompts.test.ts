import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { ResolvedModel } from "../chat/llm";
import { researchSettings } from "./config";
import { planQueries } from "./deepResearch";
import { buildQueryPrompt, cleanQuery, contextKey, DEFAULT_RESEARCH_SYSTEM_PROMPT, generateResearchQuery, queryCache } from "./prompts";

function fakeLlm(text: string) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
      warnings: [],
    }),
  } as never);
  const llm = { model, modelId: "research-x", options: () => ({}) } as unknown as ResolvedModel;
  return { model, llm };
}

const system = (call: unknown) => (call as { prompt: { role: string; content: unknown }[] }).prompt.find((m) => m.role === "system")?.content;

describe("research query prompt", () => {
  it("includes name, curriculum, sources and chat titles", () => {
    const p = buildQueryPrompt({
      name: "Biology",
      curriculum: { title: "Cell biology", topics: [{ id: "1", title: "Mitosis", description: "", group: "" }] },
      sources: [{ title: "Campbell ch. 3" }, { title: "Khan: cells" }],
      threads: [{ title: "Why do cells divide?" }, { title: "  " }],
    });
    for (const part of ["Biology", "Cell biology", "Mitosis", "Campbell ch. 3", "Khan: cells", "Why do cells divide?"]) expect(p).toContain(part);
  });

  it("omits empty sections", () => {
    const p = buildQueryPrompt({ name: "Biology" });
    expect(p).not.toContain("Sources already added");
    expect(p).not.toContain("Recent chats");
  });

  it("cleans model output", () => {
    expect(cleanQuery(' "Cell division\n basics" ', "x")).toBe("Cell division basics");
    expect(cleanQuery("  ", "Biology")).toBe("Biology");
  });

  it("cache key changes with sources and model", () => {
    const a = contextKey({ name: "B", sources: [{ title: "x" }] }, "m1");
    expect(contextKey({ name: "B", sources: [{ title: "x" }, { title: "y" }] }, "m1")).not.toBe(a);
    expect(contextKey({ name: "B", sources: [{ title: "x" }] }, "m2")).not.toBe(a);
    queryCache.set("s", a, "q");
    expect(queryCache.get("s", a)).toBe("q");
    expect(queryCache.get("s", "other")).toBeNull();
  });
});

describe("research settings", () => {
  it("defaults to the chat model and the built-in prompt", () => {
    expect(researchSettings({})).toEqual({ model: null, systemPrompt: DEFAULT_RESEARCH_SYSTEM_PROMPT, customPrompt: false });
  });

  it("uses a custom prompt, and treats null, blank or default text as unset", () => {
    expect(researchSettings({ researchSystemPrompt: "Only papers." })).toMatchObject({ systemPrompt: "Only papers.", customPrompt: true });
    for (const v of [null, "  ", DEFAULT_RESEARCH_SYSTEM_PROMPT])
      expect(researchSettings({ researchSystemPrompt: v })).toMatchObject({ systemPrompt: DEFAULT_RESEARCH_SYSTEM_PROMPT, customPrompt: false });
  });

  it("reads the research model", () => {
    expect(researchSettings({ researchModel: { providerId: "p", model: "m" } }).model).toEqual({ providerId: "p", model: "m" });
  });
});

describe("research model and prompt are used", () => {
  it("planQueries sends the system prompt to the given model", async () => {
    const { model, llm } = fakeLlm('{"language":"en","queries":["a","b"]}');
    const plan = await planQueries("mitosis", { llm, systemPrompt: "Only papers.", http: (async () => ({})) as never });
    expect(plan.queries).toEqual(["a", "b"]);
    expect(system(model.doGenerateCalls[0])).toBe("Only papers.");
  });

  it("falls back to the default system prompt", async () => {
    const { model, llm } = fakeLlm('{"queries":["a"]}');
    await planQueries("mitosis", { llm, http: (async () => ({})) as never });
    expect(system(model.doGenerateCalls[0])).toBe(DEFAULT_RESEARCH_SYSTEM_PROMPT);
  });

  it("generateResearchQuery uses the prompt and returns cleaned text", async () => {
    const { model, llm } = fakeLlm('"Cell division and genetics"');
    const q = await generateResearchQuery({ name: "Biology", sources: [{ title: "Campbell" }] }, { llm, systemPrompt: "Custom." });
    expect(q).toBe("Cell division and genetics");
    expect(system(model.doGenerateCalls[0])).toBe("Custom.");
  });
});
