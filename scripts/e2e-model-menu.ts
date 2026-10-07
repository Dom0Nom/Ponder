/**
 * Live check of the OpenRouter model list parsing, per-model capabilities and a chat turn that uses the
 * stored per-model reasoning setting.
 * Run: OPENROUTER_API_KEY=… bun scripts/e2e-model-menu.ts
 */
import { readFileSync } from "node:fs";
import { streamText } from "ai";
import { storedControls } from "../src/lib/chat/controls";
import { controlsKey, modelCapabilities } from "../src/lib/providers/controls";
import type { CallOptionInput } from "../src/lib/providers/model";
import { recommendedModels, searchModels, setOpenRouterModels } from "../src/lib/providers/openrouter";
import { useUi } from "../src/stores/ui";
import type { OpenRouterModel } from "../src/lib/types";
import { liveModel } from "./lib/liveModel";

if (!process.env.OPENROUTER_API_KEY) {
  const file = `${process.env.HOME}/Library/Application Support/dev.ponder.app/dev-secrets.json`;
  process.env.OPENROUTER_API_KEY = JSON.parse(readFileSync(file, "utf8"))["or-dev"];
}

const res = await fetch("https://openrouter.ai/api/v1/models");
const raw = (await res.json()) as { data: { id: string; name?: string; context_length?: number; created?: number; supported_parameters?: string[]; reasoning?: { mandatory?: boolean; supported_efforts?: string[] | null; default_effort?: string | null; default_enabled?: boolean | null; supports_max_tokens?: boolean } | null }[] };
const models: OpenRouterModel[] = raw.data.map((m) => ({
  id: m.id,
  name: m.name ?? m.id,
  contextLength: m.context_length ?? null,
  supportedParameters: m.supported_parameters ?? [],
  created: m.created ?? null,
  reasoning: m.reasoning
    ? {
        mandatory: !!m.reasoning.mandatory,
        supportedEfforts: m.reasoning.supported_efforts ?? null,
        defaultEffort: m.reasoning.default_effort ?? null,
        defaultEnabled: m.reasoning.default_enabled ?? null,
        supportsMaxTokens: !!m.reasoning.supports_max_tokens,
      }
    : null,
}));
setOpenRouterModels(models);
console.log(`models: ${models.length}, recommended present: ${recommendedModels(models).length}`);
console.log(`search "haiku": ${searchModels(models, "haiku").slice(0, 3).map((m) => m.id).join(", ")}`);

const llm = liveModel("deepseek/deepseek-v4.1-flash");
for (const id of ["deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-5.5", "anthropic/claude-opus-5.5", "openai/gpt-6-luna"]) {
  const c = modelCapabilities(llm.provider, id);
  console.log(
    `${id}: effort=${c.effort?.options.map((o) => o.value).join("/") ?? "none"} (default ${c.effort?.default ?? "-"}) thinking=${c.thinking ? `switch(default ${c.thinking.default ? "on" : "off"})` : "none"} temperature=${!!c.temperature} verbosity=${!!c.verbosity}`,
  );
}

const CHECKS: [string, CallOptionInput][] = [
  ["anthropic/claude-haiku-5.5", { effort: "low" }],
  ["anthropic/claude-haiku-5.5", { thinking: false }],
  ["anthropic/claude-haiku-5.5", { effort: "xhigh" }],
  ["anthropic/claude-sonnet-5.5", { effort: "medium", thinking: false }],
  ["deepseek/deepseek-v4.1-flash", { thinking: false }],
  ["deepseek/deepseek-v4.1-flash", { effort: "low" }],
  ["openai/gpt-6-luna", { effort: "low", verbosity: "low" }],
  ["openai/gpt-6-luna", { thinking: false }],
  ["openai/gpt-5-mini", { effort: "minimal" }],
  ["google/gemini-3.5-flash-lite", { effort: "minimal" }],
  ["google/gemini-3.8-flash", { effort: "low" }],
];
let failed = 0;
for (const [id, input] of CHECKS) {
  const m = liveModel(id);
  const options = m.options(input);
  let status = "200";
  let text = "";
  try {
    const r = streamText({ model: m.model, prompt: "Reply with the single word: ok", ...options });
    for await (const p of r.stream) {
      if (p.type === "text-delta") text += p.text;
      if (p.type === "error") throw p.error;
    }
    if (!text.trim()) status = "200 but empty";
  } catch (e) {
    status = `FAIL ${String((e as Error)?.message ?? e).slice(0, 160)}`;
    failed++;
  }
  console.log(`${id} ${JSON.stringify(input)} -> ${JSON.stringify(options.providerOptions ?? {})} => ${status} ${text.trim().slice(0, 20)}`);
}
if (failed) throw new Error(`${failed} request(s) rejected`);

useUi.getState().setModelControls(controlsKey(llm.provider.id, llm.modelId), { effort: "high", temperature: 0.3 });
const controls = storedControls(llm);
const options = llm.options(controls);
console.log(`stored controls: ${JSON.stringify(controls)} -> call options: ${JSON.stringify(options)}`);

const t = Date.now();
const r = streamText({ model: llm.model, prompt: "In one sentence, why is the sky blue?", ...options });
let text = "";
let reasoning = 0;
for await (const p of r.stream) {
  if (p.type === "text-delta") text += p.text;
  if (p.type === "reasoning-delta") reasoning += p.text.length;
}
console.log(`reply (${Date.now() - t} ms, ${reasoning} reasoning chars): ${text.trim()}`);
if (!text.trim()) throw new Error("empty reply");
