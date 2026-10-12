import type { Audio } from "./speech";

/** Kokoro-82M (Apache-2.0), run on this computer. Weights and voices download from Hugging Face on first use and stay cached. */
export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

export const KOKORO_VOICES = [
  "af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "af_nova", "af_sky", "af_alloy", "af_jessica", "af_river",
  "am_michael", "am_fenrir", "am_puck", "am_echo", "am_eric", "am_liam", "am_onyx", "am_adam", "am_santa",
  "bf_emma", "bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_fable", "bm_lewis", "bm_daniel",
] as const;

export type KokoroIn = { id: number; text: string; voice: string };
export type KokoroOut =
  | { type: "done"; id: number; wav: ArrayBuffer }
  | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (a: Audio) => void; reject: (e: Error) => void }>();

function start(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<KokoroOut>) => {
    const m = e.data;
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    if (m.type === "done") p.resolve({ bytes: new Uint8Array(m.wav), mime: "audio/wav" });
    else p.reject(new Error(m.message));
  };
  w.onerror = (e) => {
    const err = new Error(e.message || "The offline voice stopped.");
    waiting.forEach((p) => p.reject(err));
    waiting.clear();
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

export function kokoroSpeak(text: string, voice: string): Promise<Audio> {
  const id = nextId++;
  const v = (KOKORO_VOICES as readonly string[]).includes(voice) ? voice : KOKORO_VOICES[0];
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    start().postMessage({ id, text, voice: v } satisfies KokoroIn);
  });
}
