import { api } from "../ipc";
import { s } from "../strings";
import type { Provider, ProxyRequest } from "../types";

export const SPEECH_SERVICES = ["openrouter", "openai", "gemini", "elevenlabs", "fish"] as const;
export type SpeechService = (typeof SPEECH_SERVICES)[number];

export interface SpeechSettings {
  service: SpeechService;
  model: string;
  voice: string;
  /** Second host in audio overviews. */
  voice2: string;
  speed: number;
  sttModel: string;
}

export const SPEECH_KEY = "speech";

export const DEFAULT_MODEL: Record<SpeechService, { model: string; voice: string; voice2: string }> = {
  openrouter: { model: "hexgrad/kokoro-82m", voice: "af_heart", voice2: "am_adam" },
  openai: { model: "gpt-4o-mini-tts", voice: "alloy", voice2: "echo" },
  gemini: { model: "gemini-2.5-flash-preview-tts", voice: "Kore", voice2: "Puck" },
  elevenlabs: { model: "eleven_multilingual_v2", voice: "21m00Tcm4TlvDq8ikWAM", voice2: "pNInz6obpgDQGcFmaJgB" },
  fish: { model: "s1", voice: "", voice2: "" },
};

export const DEFAULT_SPEECH: SpeechSettings = { service: "openrouter", ...DEFAULT_MODEL.openrouter, speed: 1, sttModel: "openai/whisper-large-v3-turbo" };

/** Whether the picked service can be called: a matching provider, or a saved key for keyed services. */
export function speechReady(cfg: SpeechSettings, providers: Provider[], hasKey: boolean): boolean {
  if (KEYED_SPEECH[cfg.service]) return hasKey;
  return providers.some((p) => p.type === PROVIDER_TYPE[cfg.service]);
}

export function speechSettings(settings: Record<string, unknown> | undefined): SpeechSettings {
  const v = (settings?.[SPEECH_KEY] ?? {}) as Partial<SpeechSettings>;
  const service = SPEECH_SERVICES.includes(v.service as SpeechService) ? (v.service as SpeechService) : DEFAULT_SPEECH.service;
  const sameService = service === (v.service ?? DEFAULT_SPEECH.service);
  const str = (x: unknown, d: string) => (typeof x === "string" && x.trim() ? x.trim() : d);
  const speed = typeof v.speed === "number" && v.speed >= 0.5 && v.speed <= 2 ? v.speed : 1;
  return {
    service,
    model: sameService ? str(v.model, DEFAULT_MODEL[service].model) : DEFAULT_MODEL[service].model,
    voice: sameService ? (typeof v.voice === "string" ? v.voice : DEFAULT_MODEL[service].voice) : DEFAULT_MODEL[service].voice,
    voice2: sameService ? (typeof v.voice2 === "string" ? v.voice2 : DEFAULT_MODEL[service].voice2) : DEFAULT_MODEL[service].voice2,
    speed,
    sttModel: str(v.sttModel, DEFAULT_SPEECH.sttModel),
  };
}

/** Services whose key lives in the secret store rather than on an AI provider. */
export const KEYED_SPEECH: Partial<Record<SpeechService, string>> = { elevenlabs: "tts:elevenlabs", fish: "tts:fish" };

const PROVIDER_TYPE: Partial<Record<SpeechService, Provider["type"]>> = { openrouter: "openrouter", openai: "openai", gemini: "google" };

export class SpeechSetupError extends Error {}

export interface SpeechTarget {
  providerId: string;
  /** API root without a trailing slash, e.g. https://openrouter.ai/api */
  base: string;
}

const OFFICIAL: Record<SpeechService, string> = {
  openrouter: "https://openrouter.ai/api",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  elevenlabs: "https://api.elevenlabs.io",
  fish: "https://api.fish.audio",
};

export function speechTarget(service: SpeechService, providers: Provider[]): SpeechTarget {
  const keyed = KEYED_SPEECH[service];
  if (keyed) return { providerId: keyed, base: OFFICIAL[service] };
  const p = providers.find((x) => x.type === PROVIDER_TYPE[service]);
  if (!p) throw new SpeechSetupError(s.speech.noProvider(s.speech.services[service]));
  const base = (p.baseUrl?.trim() || OFFICIAL[service]).replace(/\/+$/, "").replace(/\/v1$/, "");
  return { providerId: p.id, base };
}

const json = { "content-type": "application/json" };

export function speechRequest(t: SpeechTarget, cfg: SpeechSettings, text: string): ProxyRequest {
  const post = (url: string, body: unknown, headers: Record<string, string> = {}): ProxyRequest => ({
    id: crypto.randomUUID(),
    url,
    method: "POST",
    headers: { ...json, ...headers },
    body: JSON.stringify(body),
    providerId: t.providerId,
  });
  switch (cfg.service) {
    case "openrouter":
      return post(`${t.base}/v1/audio/speech`, { model: cfg.model, input: text, ...(cfg.voice ? { voice: cfg.voice } : {}), response_format: "mp3" });
    case "openai":
      return post(`${t.base}/v1/audio/speech`, { model: cfg.model, input: text, voice: cfg.voice || "alloy", response_format: "mp3" });
    case "gemini":
      return post(`${t.base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice || "Kore" } } } },
      });
    case "elevenlabs":
      return post(`${t.base}/v1/text-to-speech/${encodeURIComponent(cfg.voice || DEFAULT_MODEL.elevenlabs.voice)}?output_format=mp3_44100_128`, { text, model_id: cfg.model });
    case "fish":
      return post(`${t.base}/v1/tts`, { text, format: "mp3", ...(cfg.voice ? { reference_id: cfg.voice } : {}) }, { model: cfg.model });
  }
}

export interface Audio {
  bytes: Uint8Array;
  mime: string;
}

/** Gemini answers JSON with base64 16-bit PCM at 24 kHz; everything else sends MP3 bytes. */
export function decodeSpeech(service: SpeechService, bytes: Uint8Array): Audio {
  if (service !== "gemini") return { bytes, mime: "audio/mpeg" };
  const r = JSON.parse(new TextDecoder().decode(bytes)) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
  const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!part?.data) throw new Error(s.speech.noAudio);
  const rate = Number(part.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
  return { bytes: pcmToWav(base64ToBytes(part.data), rate), mime: "audio/wav" };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Wraps mono 16-bit little-endian PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const tag = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Plain text for reading aloud: no Markdown syntax, citations or code blocks. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+(?:[-–,]\s*\d+)*\]/g, "")
    .replace(/\$\$?([^$]+)\$\$?/g, "$1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?:;,…]["')\]]*$/.test(l) ? l : `${l}.`))
    .join("\n");
}

/** Splits text at sentence ends into pieces of at most `max` characters, so the first audio arrives fast. */
export function speechChunks(text: string, max = 600, first = 220): string[] {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  let cur = "";
  const limit = () => (out.length === 0 ? first : max);
  for (const sentence of sentences) {
    for (const piece of hardSplit(sentence, max)) {
      if (cur && (cur + " " + piece).length > limit()) {
        out.push(cur);
        cur = piece;
      } else cur = cur ? cur + " " + piece : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function hardSplit(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export async function synthesize(cfg: SpeechSettings, text: string, providers?: Provider[]): Promise<Audio> {
  const target = speechTarget(cfg.service, providers ?? (await api.listProviders()));
  const bytes = await api.httpBytes(speechRequest(target, cfg, text));
  return decodeSpeech(cfg.service, bytes);
}

export interface SpeechModel {
  id: string;
  name: string;
  voices: string[];
  free: boolean;
}

/** OpenRouter's live list of speech (or transcription) models. */
export async function openRouterAudioModels(kind: "speech" | "transcription", providers?: Provider[]): Promise<SpeechModel[]> {
  const t = speechTarget("openrouter", providers ?? (await api.listProviders()));
  const bytes = await api.httpBytes({ id: crypto.randomUUID(), url: `${t.base}/v1/models?output_modalities=${kind}`, method: "GET", headers: {}, providerId: t.providerId });
  const r = JSON.parse(new TextDecoder().decode(bytes)) as { data?: { id: string; name?: string; supported_voices?: string[] | null; pricing?: { prompt?: string } }[] };
  return (r.data ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    voices: Array.isArray(m.supported_voices) ? m.supported_voices : [],
    free: m.id.endsWith(":free") || Number(m.pricing?.prompt ?? 1) === 0,
  }));
}

export const AUDIO_FORMATS = ["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"] as const;

/** Speech to text through OpenRouter (`/v1/audio/transcriptions`, base64 JSON). */
export async function transcribe(cfg: SpeechSettings, audio: Uint8Array, format: (typeof AUDIO_FORMATS)[number], language?: string, providers?: Provider[]): Promise<string> {
  const t = speechTarget("openrouter", providers ?? (await api.listProviders()));
  const bytes = await api.httpBytes({
    id: crypto.randomUUID(),
    url: `${t.base}/v1/audio/transcriptions`,
    method: "POST",
    headers: json,
    body: JSON.stringify({ model: cfg.sttModel, input_audio: { data: bytesToBase64(audio), format }, ...(language ? { language } : {}) }),
    providerId: t.providerId,
  });
  const r = JSON.parse(new TextDecoder().decode(bytes)) as { text?: unknown };
  if (typeof r.text !== "string") throw new Error(s.speech.noTranscript);
  return r.text.trim();
}
