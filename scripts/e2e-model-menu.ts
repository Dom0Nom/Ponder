/**
 * Live check of the OpenRouter model list parsing, per-model capabilities and a chat turn that uses the
 * stored per-model reasoning setting.
 * Run: OPENROUTER_API_KEY=… bun scripts/e2e-model-menu.ts
 */
import { streamText } from "ai";
import { storedControls } from "../src/lib/chat/controls";
import { controlsKey, modelCapabilities } from "../src/lib/providers/controls";
import { recommendedModels, searchModels, setOpenRouterModels } from "../src/lib/providers/openrouter";
import { useUi } from "../src/stores/ui";
import type { OpenRouterModel } from "../src/lib/types";
import { liveModel } from "./lib/liveModel";

const res = await fetch("https://openrouter.ai/api/v1/models");
const raw = (await res.json()) as { data: { id: string; name?: string; context_length?: number; created?: number; supported_parameters?: string[] }[] };
const models: OpenRouterModel[] = raw.data.map((m) => ({
  id: m.id,
  name: m.name ?? m.id,
  contextLength: m.context_length ?? null,
  supportedParameters: m.supported_parameters ?? [],
  created: m.created ?? null,
}));
setOpenRouterModels(models);
console.log(`models: ${models.length}, recommended present: ${recommendedModels(models).length}`);
console.log(`search "haiku": ${searchModels(models, "haiku").slice(0, 3).map((m) => m.id).join(", ")}`);

const llm = liveModel("deepseek/deepseek-v4.1-flash");
for (const id of ["deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-4.5"]) {
  const m = models.find((x) => x.id === id);
  if (!m) throw new Error(`${id} missing from OpenRouter list`);
  const caps = modelCapabilities(llm.provider, id);
  console.log(
    `${id}: params=[${m.supportedParameters.filter((p) => /reasoning|temperature|verbosity/.test(p)).join(",")}] -> levels=${caps.reasoningLevels?.map((l) => l.value).join("/") ?? "none"} thinking=${caps.thinkingToggle} temperature=${caps.temperature}`,
  );
}

useUi.getState().setModelControls(controlsKey(llm.provider.id, llm.modelId), { reasoning: "high", temperature: 0.3 });
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
