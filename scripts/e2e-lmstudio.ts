/**
 * Live check of the openai-compatible path against a real LM Studio server.
 * Run: bun scripts/e2e-lmstudio.ts [baseUrl] [model]
 */
import { streamText } from "ai";
import { callOptions, createLanguageModel } from "../src/lib/providers/model";
import type { Provider } from "../src/lib/types";

const baseUrl = process.argv[2] ?? process.env.LMSTUDIO_URL ?? "http://192.168.1.20:1234/v1";
const modelId = process.argv[3] ?? process.env.LMSTUDIO_MODEL ?? "qwen3.5-9b";

const provider: Provider = {
  id: "e2e-lmstudio",
  type: "lmstudio",
  kind: "local",
  name: "LM Studio (e2e)",
  baseUrl,
  config: { models: [modelId], defaultModel: modelId },
  createdAt: 0,
};

async function run(thinking: boolean) {
  const model = createLanguageModel(provider, modelId, { fetch: globalThis.fetch });
  const started = Date.now();
  const result = streamText({
    model,
    prompt: "What is 17 times 3? Reply with one short sentence.",
    ...callOptions(provider, { thinking }),
  });
  let text = "";
  let reasoning = "";
  let textParts = 0;
  let reasoningParts = 0;
  let firstTextMs: number | null = null;
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      textParts++;
      text += part.text;
      firstTextMs ??= Date.now() - started;
    } else if (part.type === "reasoning-delta") {
      reasoningParts++;
      reasoning += part.text;
    } else if (part.type === "error") {
      throw part.error;
    }
  }
  const usage = await result.usage;
  return { thinking, text: text.trim(), textParts, reasoningParts, reasoningChars: reasoning.length, firstTextMs, totalMs: Date.now() - started, usage };
}

let failed = false;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed = true;
}

console.log(`LM Studio e2e: ${baseUrl} model ${modelId}\n`);

const off = await run(false);
console.log("thinking off:", JSON.stringify(off, null, 2));
check("thinking off streams text", off.textParts > 1 && off.text.length > 0);
check("thinking off has no reasoning", off.reasoningParts === 0);

const on = await run(true);
console.log("\nthinking on:", JSON.stringify({ ...on, text: on.text.slice(0, 200) }, null, 2));
check("thinking on streams text", on.textParts > 0 && on.text.length > 0);
check("thinking on streams reasoning-delta parts", on.reasoningParts > 0);

process.exit(failed ? 1 : 0);
