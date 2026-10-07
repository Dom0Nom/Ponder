import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenRouterModel, Provider } from "../types";

vi.mock("../ipc", () => ({ api: { listOpenrouterModels: vi.fn() } }));

import { storedControls } from "../chat/controls";
import type { ResolvedModel } from "../chat/llm";
import { useUi } from "../../stores/ui";
import { openRouterFixture } from "../../test/openrouterFixture";
import { catalog } from "./catalog";
import { controlsKey, effortLabel, modelCapabilities, openRouterCapabilities, resolveControls } from "./controls";
import { RECOMMENDED_MODELS, authorOf, recommendedModels, searchModels, setOpenRouterModels } from "./openrouter";

const m = (id: string, supportedParameters: string[], created = 1): OpenRouterModel => ({
  id,
  name: id,
  contextLength: null,
  supportedParameters,
  created,
});

const provider: Provider = { id: "or", type: "openrouter", kind: "apiKey", name: "OpenRouter", baseUrl: null, config: {}, createdAt: 0 };
const llm = (modelId: string) => ({ provider, modelId }) as unknown as ResolvedModel;

beforeEach(() => {
  setOpenRouterModels(openRouterFixture);
  useUi.setState({ modelControls: {} });
});

describe("per-model capabilities", () => {
  it("derives controls from OpenRouter's supported parameters", () => {
    const effort = openRouterCapabilities(m("a/x", ["reasoning", "reasoning_effort", "temperature"]));
    expect(effort.reasoningLevels?.map((l) => l.value)).toEqual(["low", "medium", "high"]);
    expect(effort.thinkingToggle).toBe(true);
    expect(effort.temperature).toBe(true);

    const toggleOnly = openRouterCapabilities(m("a/y", ["reasoning"]));
    expect(toggleOnly.reasoningLevels).toBeNull();
    expect(toggleOnly.thinkingToggle).toBe(true);
    expect(toggleOnly.temperature).toBe(false);

    const plain = openRouterCapabilities(m("a/z", ["temperature"]));
    expect(plain.thinkingToggle).toBe(false);
    expect(plain.reasoningToggle).toBe(false);
  });

  it("uses the catalog for other providers and unknown OpenRouter models", () => {
    expect(modelCapabilities({ ...provider, type: "anthropic" }, "claude")).toBe(catalog.anthropic.capabilities);
    expect(modelCapabilities(provider, "not/listed")).toBe(catalog.openrouter.capabilities);
    expect(modelCapabilities(provider, "meta-llama/llama-4-maverick").thinkingToggle).toBe(false);
    expect(modelCapabilities(provider, "deepseek/deepseek-v4.1-flash").reasoningLevels).not.toBeNull();
  });

  it("drops stored values the model can't take and defaults reasoning off only where it reasons", () => {
    const plainCaps = modelCapabilities(provider, "meta-llama/llama-4-maverick");
    expect(resolveControls(provider, { reasoning: "high", temperature: 0.3 }, plainCaps)).toEqual({ temperature: 0.3 });
    const reasoningCaps = modelCapabilities(provider, "deepseek/deepseek-v4.1-flash");
    expect(resolveControls(provider, undefined, reasoningCaps)).toEqual({ reasoning: "none" });
    expect(effortLabel(provider, { reasoning: "high" }, reasoningCaps)).toBe("High");
  });
});

describe("controls are stored per provider and model", () => {
  it("keeps separate values and runTurn input follows the model in use", () => {
    const a = "deepseek/deepseek-v4.1-flash";
    const b = "qwen/qwen3.8-flash";
    useUi.getState().setModelControls(controlsKey("or", a), { reasoning: "high", temperature: 0.7 });
    expect(storedControls(llm(a))).toMatchObject({ reasoning: "high", temperature: 0.7 });
    expect(storedControls(llm(b))).toEqual({ reasoning: "none" });
    useUi.getState().setModelControls(controlsKey("or", b), { reasoning: "medium" });
    expect(storedControls(llm(a))).toMatchObject({ reasoning: "high" });
    expect(storedControls(llm(b))).toMatchObject({ reasoning: "medium" });
    expect(storedControls(llm("meta-llama/llama-4-maverick"))).toEqual({});
  });

  it("does not share values between providers with the same model id", () => {
    useUi.getState().setModelControls(controlsKey("p1", "m"), { temperature: 1 });
    expect(useUi.getState().modelControls[controlsKey("p2", "m")]).toBeUndefined();
  });

  it("remembers recent models newest first without duplicates", () => {
    const { pushRecentModel } = useUi.getState();
    pushRecentModel("or", "a/1");
    pushRecentModel("or", "a/2");
    pushRecentModel("or", "a/1");
    expect(useUi.getState().recentModels.or).toEqual(["a/1", "a/2"]);
  });
});

describe("recommended list", () => {
  it("keeps curated order and only models the list contains", () => {
    const list = [m("deepseek/deepseek-v4.1-flash", []), m("anthropic/claude-opus-5.5", []), m("someone/else", [])];
    expect(recommendedModels(list).map((x) => x.id)).toEqual(["anthropic/claude-opus-5.5", "deepseek/deepseek-v4.1-flash"]);
    expect(recommendedModels(list, "deepseek").map((x) => x.id)).toEqual(["deepseek/deepseek-v4.1-flash"]);
    expect(recommendedModels([])).toEqual([]);
  });

  it("only names models from the author filter set", () => {
    for (const id of RECOMMENDED_MODELS) expect(authorOf(id)).toMatch(/^(anthropic|openai|google|deepseek|meta-llama|mistralai|x-ai|qwen)$/);
  });
});

describe("search and author filter", () => {
  it("matches every term against id or name, case-insensitively", () => {
    expect(searchModels(openRouterFixture, "CLAUDE haiku").map((x) => x.id)).toEqual([
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-haiku-4.5",
    ]);
    expect(searchModels(openRouterFixture, "zzz")).toEqual([]);
  });

  it("filters by author with and without a query, newest first", () => {
    const ds = searchModels(openRouterFixture, "", "deepseek");
    expect(ds.map((x) => x.id)).toEqual(["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4-pro"]);
    expect(searchModels(openRouterFixture, "pro", "deepseek").map((x) => x.id)).toEqual(["deepseek/deepseek-v4-pro"]);
    expect(searchModels(openRouterFixture, "gemma", "anthropic")).toEqual([]);
  });

  it("hides batch variants", () => {
    expect(searchModels([m("a/x", []), m("a/x:batch", [])], "x").map((r) => r.id)).toEqual(["a/x"]);
  });
});

describe("author logos", () => {
  it("maps authors to sites, with guesses for unknown ones", async () => {
    const { authorSites, baseAuthor, hostOfBaseUrl } = await import("./openrouter");
    expect(authorSites("xiaomi")).toEqual(["mi.com"]);
    expect(authorSites("~moonshotai")).toEqual(["moonshot.ai"]);
    expect(authorSites("newlab")).toEqual(["newlab.com", "newlab.ai"]);
    expect(authorSites("we!rd")).toEqual([]);
    expect(baseAuthor("~z-ai")).toBe("z-ai");
    expect(hostOfBaseUrl("https://api.kimi.ai/coding/v1")).toBe("api.kimi.ai");
    for (const u of ["http://192.168.1.20:1234/v1", "http://localhost:11434", "http://[::1]:80", "http://nas.local/v1", null, ""]) {
      expect(hostOfBaseUrl(u)).toBeNull();
    }
  });

  it("bundled authors resolve without a site lookup", async () => {
    const { authorIconUrl } = await import("./icons");
    expect(authorIconUrl("~anthropic")).toBeTruthy();
    expect(authorIconUrl("meta")).toBeTruthy();
    expect(authorIconUrl("xiaomi")).toBeUndefined();
  });
});
