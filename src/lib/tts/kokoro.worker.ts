import { env, KokoroTTS } from "kokoro-js";
import ortMjs from "../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasm from "../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import { KOKORO_MODEL, type KokoroIn, type KokoroOut } from "./kokoro";

env.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

let model: Promise<KokoroTTS> | null = null;

const post = (m: KokoroOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function load(): Promise<KokoroTTS> {
  model ??= KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "wasm" }).catch((e) => {
    model = null;
    throw e;
  });
  return model;
}

self.onmessage = async (e: MessageEvent<KokoroIn>) => {
  const { id, text, voice } = e.data;
  try {
    const tts = await load();
    const audio = await tts.generate(text, { voice: voice as never });
    const wav = audio.toWav();
    post({ type: "done", id, wav }, [wav]);
  } catch (err) {
    post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
