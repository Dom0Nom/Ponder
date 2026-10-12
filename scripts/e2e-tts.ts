/**
 * Live check of text to speech and speech to text through OpenRouter. Writes audio files, never plays them.
 * Run: OPENROUTER_API_KEY=… bun scripts/e2e-tts.ts [--model hexgrad/kokoro-82m --voice af_heart] [--stt openai/whisper-large-v3-turbo] [--out design/compare/tts]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bytesToBase64, decodeSpeech, speakable, speechChunks, speechRequest, speechSettings } from "../src/lib/tts/speech";
import type { ProxyRequest } from "../src/lib/types";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is not set");
const OUT = resolve(opt("out", "design/compare/tts"));
mkdirSync(OUT, { recursive: true });
const base = "https://openrouter.ai/api";

async function send(r: ProxyRequest): Promise<Uint8Array> {
  const res = await fetch(r.url, { method: r.method, headers: { ...r.headers, Authorization: `Bearer ${key}` }, body: r.body ?? undefined });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${res.status}: ${new TextDecoder().decode(bytes).slice(0, 300)}`);
  return bytes;
}

const duration = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

const cfg = speechSettings({ speech: { service: "openrouter", model: opt("model", "hexgrad/kokoro-82m"), voice: opt("voice", "af_heart"), sttModel: opt("stt", "openai/whisper-large-v3-turbo") } });
const answer = `## How plants make sugar

**Photosynthesis** happens in the chloroplasts [1]. Chlorophyll absorbs light energy and splits water, releasing oxygen.
The Calvin cycle then uses ATP and NADPH to fix carbon dioxide into sugar [2].`;
const chunks = speechChunks(speakable(answer));
console.log(`model ${cfg.model}, ${chunks.length} chunks`);

let total = 0;
const files: string[] = [];
for (const [i, chunk] of chunks.entries()) {
  const t0 = Date.now();
  const audio = decodeSpeech("openrouter", await send(speechRequest({ providerId: "openrouter", base }, cfg, chunk)));
  const file = join(OUT, `chunk-${i}.mp3`);
  writeFileSync(file, audio.bytes);
  const d = duration(file);
  total += d;
  files.push(file);
  console.log(`chunk ${i}: ${audio.bytes.length} bytes, ${d.toFixed(2)} s audio in ${Date.now() - t0} ms`);
  if (d < 1) throw new Error(`chunk ${i} is too short`);
}

const t0 = Date.now();
const res = await send({
  id: "stt",
  url: `${base}/v1/audio/transcriptions`,
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: cfg.sttModel, input_audio: { data: bytesToBase64(new Uint8Array(await Bun.file(files[0]).arrayBuffer())), format: "mp3" } }),
  providerId: "openrouter",
});
const text = (JSON.parse(new TextDecoder().decode(res)) as { text: string }).text;
const said = new Set(words(text));
const expected = words(chunks[0]);
const hit = expected.filter((w) => said.has(w)).length / expected.length;
console.log(`stt ${cfg.sttModel} in ${Date.now() - t0} ms: "${text.trim()}"`);
console.log(`word recall ${(hit * 100).toFixed(0)}%, total audio ${total.toFixed(1)} s, files in ${OUT}`);
if (hit < 0.8) throw new Error("transcript doesn't match the spoken text");
