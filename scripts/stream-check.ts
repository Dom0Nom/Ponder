// End-to-end streaming check without the webview: real Rust proxy (`cargo run --example
// proxy_stream`), real Tauri `Channel` ordering code, real `createProxyFetch`, real AI SDK.
// Only the Tauri IPC transport is simulated, and it delivers channel messages out of order on purpose.
//
//   bun scripts/stream-check.ts                 hostile mock server (scripts/mock-sse-server.ts)
//   bun scripts/stream-check.ts --slow          adds the 30 s pause cases
//   OPENROUTER_API_KEY=… bun scripts/stream-check.ts --live [model]   long answer from OpenRouter
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { answerFor, startMockSse } from "./mock-sse-server";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const SLOW = args.includes("--slow");

const build = spawnSync("cargo", ["build", "--quiet", "--example", "proxy_stream"], { cwd: join(ROOT, "src-tauri"), stdio: "inherit" });
if (build.status !== 0) process.exit(1);
const BIN = join(ROOT, "src-tauri/target/debug/examples/proxy_stream");

// ---- fake Tauri internals: invoke("http_stream") runs the Rust proxy and feeds the channel ----
type Cb = (raw: unknown) => void;
const callbacks = new Map<number, Cb>();
let nextCb = 1;
const children = new Map<string, ReturnType<typeof spawn>>();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback(cb: Cb) {
    const id = nextCb++;
    callbacks.set(id, cb);
    return id;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  async invoke(cmd: string, a: Record<string, unknown>) {
    if (cmd === "http_abort") {
      children.get(a.id as string)?.kill();
      return null;
    }
    if (cmd !== "http_stream") throw new Error(`unexpected command ${cmd}`);
    const req = a.request as { id: string; url: string; method: string; headers: Record<string, string>; body: string | null };
    const channel = a.onEvent as { id: number };
    const deliver = callbacks.get(channel.id)!;
    const headers = { ...req.headers };
    if (LIVE) headers.authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
    const child = spawn(BIN, [], { stdio: ["pipe", "pipe", "inherit"] });
    children.set(req.id, child);
    child.stdin.end(JSON.stringify({ url: req.url, method: req.method, headers, body: req.body }));
    let index = 0;
    let buf = "";
    await new Promise<void>((resolve) => {
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const i = index++;
          // Tauri fetches large channel payloads separately, so later messages can overtake them.
          setTimeout(() => deliver({ message: JSON.parse(line), index: i }), Math.random() * 25);
        }
      });
      child.on("close", () => {
        const i = index;
        setTimeout(() => deliver({ end: true, index: i }), 30);
        resolve();
      });
    });
    return null;
  },
};

const { streamText } = await import("ai");
const { createLanguageModel } = await import("../src/lib/providers/model");
const { describeError } = await import("../src/lib/chat/runner");

async function runOne(baseUrl: string, model: string, prompt = "hi") {
  const provider = { id: "check", type: LIVE ? "openrouter" : "openai-compatible", kind: "apiKey", name: "Check", baseUrl, config: {}, createdAt: 0 };
  const started = Date.now();
  const result = streamText({ model: createLanguageModel(provider as never, model), prompt });
  let text = "";
  let error: string | null = null;
  let maxGap = 0;
  let last = Date.now();
  try {
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        text += part.text;
        maxGap = Math.max(maxGap, Date.now() - last);
        last = Date.now();
      } else if (part.type === "error") throw part.error;
    }
  } catch (e) {
    error = describeError(e);
  }
  return { text, error, ms: Date.now() - started, maxGap };
}

let failed = 0;
if (LIVE) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
  const model = args.find((a) => !a.startsWith("--")) ?? "deepseek/deepseek-v4.1-flash";
  const r = await runOne(
    "https://openrouter.ai/api/v1",
    model,
    "Schreib eine ausführliche Erklärung der Photosynthese (ca. 900 Wörter) mit Formeln in LaTeX, Listen und Umlauten.",
  );
  console.log(`${model}: ${r.text.length} chars in ${r.ms} ms, longest gap between deltas ${r.maxGap} ms, error: ${r.error ?? "none"}`);
  if (r.error || r.text.length < 2000) failed++;
} else {
  const server = startMockSse(18766);
  const base = "http://127.0.0.1:18766/v1";
  const cases: [string, "full" | "partial"][] = [
    ["plain", "full"],
    ["long", "full"],
    ["split", "full"],
    ["long+split", "full"],
    ["pause-5", "full"],
    ["silent-5", "full"],
    ["gzip", "full"],
    ["close-after-done", "full"],
    ["split+close-after-done", "full"],
    ["close-early", "partial"],
    ["long+split+close-early", "partial"],
  ];
  if (SLOW) cases.push(["pause-30", "full"], ["long+split+pause-30", "full"], ["silent-30", "full"]);
  for (const [model, expect] of cases) {
    const r = await runOne(base, model);
    const full = answerFor(model);
    const ok =
      expect === "full"
        ? !r.error && r.text === full
        : !!r.error && /closed before the answer finished/.test(r.error) && r.text.length > 0 && full.startsWith(r.text);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${model}: ${r.text.length}/${full.length} chars, ${r.ms} ms${r.error ? `, error: ${r.error}` : ""}`);
  }
  server.close();
}
process.exit(failed ? 1 : 0);
