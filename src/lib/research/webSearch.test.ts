import { describe, expect, it, vi } from "vitest";
import type { Provider } from "../types";
import { createModelSearch, parseOpenRouterCitations, sourcesToResults, supportsModelSearch } from "./webSearch";

const openrouterResponse = {
  id: "gen-1760000000-abc",
  provider: "DeepSeek",
  model: "deepseek/deepseek-v4.1-flash",
  object: "chat.completion",
  choices: [
    {
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "1. Mitosis (Khan Academy): how cells divide.\n2. Cell cycle (OpenStax Biology 2e): the phases of the cycle.",
        annotations: [
          { type: "url_citation", url_citation: { url: "https://www.khanacademy.org/science/ap-biology/cell-communication-and-cell-cycle/mitosis", title: "Mitosis", content: "Mitosis is a process in which a cell divides.", start_index: 3, end_index: 9 } },
          { type: "url_citation", url_citation: { url: "https://openstax.org/books/biology-2e/pages/10-2-the-cell-cycle", title: "10.2 The Cell Cycle", content: "", start_index: 60, end_index: 70 } },
          { type: "url_citation", url_citation: { url: "https://www.khanacademy.org/science/ap-biology/cell-communication-and-cell-cycle/mitosis", title: "Mitosis again", content: "dup" } },
          { type: "file_citation", url_citation: { url: "https://example.org/ignored" } },
          { type: "url_citation", url_citation: { url: "ftp://nope", title: "x" } },
        ],
      },
    },
  ],
};

const provider = (type: Provider["type"]): Provider => ({ id: "p", type, kind: "apiKey", name: "P", baseUrl: null, config: {}, createdAt: 0 });

describe("model web search", () => {
  it("collects url_citation annotations from an OpenRouter :online response", () => {
    expect(parseOpenRouterCitations(openrouterResponse)).toEqual([
      {
        title: "Mitosis",
        url: "https://www.khanacademy.org/science/ap-biology/cell-communication-and-cell-cycle/mitosis",
        snippet: "Mitosis is a process in which a cell divides.",
        engine: "model",
      },
      { title: "10.2 The Cell Cycle", url: "https://openstax.org/books/biology-2e/pages/10-2-the-cell-cycle", snippet: "", engine: "model" },
    ]);
    expect(parseOpenRouterCitations({ choices: [{ message: { content: "no web" } }] })).toEqual([]);
    expect(parseOpenRouterCitations(null)).toEqual([]);
  });

  it("calls the model with the :online suffix through the provider's fetch", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(openrouterResponse), { status: 200 }));
    const search = createModelSearch(provider("openrouter"), "deepseek/deepseek-v4.1-flash", { fetch: fetchFn as unknown as typeof fetch })!;
    const r = await search("mitosis");
    expect(r).toHaveLength(2);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash:online");
    expect(body.messages[0].content).toContain("mitosis");
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain("authorization");
  });

  it("does not double the :online suffix and reports HTTP errors", async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":{"message":"no credits"}}', { status: 402 }));
    const search = createModelSearch(provider("openrouter"), "m:online", { fetch: fetchFn as unknown as typeof fetch })!;
    await expect(search("q")).rejects.toThrow(/HTTP 402/);
    expect(JSON.parse(((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body) as string).model).toBe("m:online");
  });

  it("extracts url sources from AI SDK results (OpenAI, Anthropic, Gemini, xAI web-search tools)", () => {
    const sources = [
      { type: "source", sourceType: "url", id: "1", url: "https://en.wikipedia.org/wiki/Mitosis", title: "Mitosis - Wikipedia" },
      { type: "source", sourceType: "url", id: "2", url: "https://en.wikipedia.org/wiki/Mitosis", title: "dup" },
      { type: "source", sourceType: "url", id: "3", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "" },
      { type: "source", sourceType: "document", id: "4", mediaType: "application/pdf", title: "file.pdf" },
      { type: "source", sourceType: "url", id: "5", url: "not a url" },
    ];
    expect(sourcesToResults(sources)).toEqual([
      { title: "Mitosis - Wikipedia", url: "https://en.wikipedia.org/wiki/Mitosis", snippet: "", engine: "model" },
      { title: "vertexaisearch.cloud.google.com", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", snippet: "", engine: "model" },
    ]);
    expect(sourcesToResults(undefined)).toEqual([]);
  });

  it("knows which providers support it", () => {
    for (const t of ["openrouter", "openai", "anthropic", "google", "xai"] as const) expect(supportsModelSearch({ type: t })).toBe(true);
    for (const t of ["groq", "lmstudio", "ollama", "openai-compatible", "chatgpt-oauth"] as const) expect(supportsModelSearch({ type: t })).toBe(false);
    expect(createModelSearch(provider("groq"), "m")).toBeNull();
  });
});
