import { describe, expect, it } from "vitest";
import type { Provider } from "../types";
import { decodeSpeech, pcmToWav, speakable, speechChunks, speechReady, speechRequest, speechSettings, speechTarget, SpeechSetupError } from "./speech";

const provider = (type: Provider["type"], baseUrl: string | null = null): Provider => ({
  id: `p-${type}`,
  type,
  kind: "apiKey",
  name: type,
  baseUrl,
  config: {},
  createdAt: 0,
});

describe("speech settings", () => {
  it("falls back to the service's defaults when the service changes", () => {
    expect(speechSettings(undefined)).toMatchObject({ service: "openrouter", model: "hexgrad/kokoro-82m", voice: "af_heart", speed: 1 });
    expect(speechSettings({ speech: { service: "openai", model: "", voice: "nova", speed: 1.5 } })).toMatchObject({
      service: "openai",
      model: "gpt-4o-mini-tts",
      voice: "nova",
      speed: 1.5,
    });
    expect(speechSettings({ speech: { service: "nope", speed: 9 } })).toMatchObject({ service: "openrouter", speed: 1 });
  });

  it("is ready with a matching provider or, for keyed services, a saved key", () => {
    const cfg = speechSettings(undefined);
    expect(speechReady(cfg, [provider("anthropic")], false)).toBe(false);
    expect(speechReady(cfg, [provider("openrouter")], false)).toBe(true);
    const fish = speechSettings({ speech: { service: "fish" } });
    expect(speechReady(fish, [], false)).toBe(false);
    expect(speechReady(fish, [], true)).toBe(true);
  });
});

describe("speech requests", () => {
  it("targets the provider's base URL without a doubled /v1", () => {
    expect(speechTarget("openrouter", [provider("openrouter", "https://openrouter.ai/api/v1/")])).toEqual({ providerId: "p-openrouter", base: "https://openrouter.ai/api" });
    expect(speechTarget("gemini", [provider("google")]).base).toBe("https://generativelanguage.googleapis.com");
    expect(speechTarget("elevenlabs", [])).toEqual({ providerId: "tts:elevenlabs", base: "https://api.elevenlabs.io" });
    expect(() => speechTarget("openai", [])).toThrow(SpeechSetupError);
  });

  it("builds each service's request", () => {
    const t = { providerId: "x", base: "https://h" };
    const body = (r: { body?: string | null }) => JSON.parse(r.body!);
    const or = speechRequest(t, speechSettings(undefined), "Hi.");
    expect(or.url).toBe("https://h/v1/audio/speech");
    expect(body(or)).toEqual({ model: "hexgrad/kokoro-82m", input: "Hi.", voice: "af_heart", response_format: "mp3" });
    expect(body(speechRequest(t, speechSettings({ speech: { service: "openrouter", model: "fish-audio/s2.1-pro-free:free", voice: "" } }), "Hi."))).not.toHaveProperty("voice");
    const gm = speechRequest(t, speechSettings({ speech: { service: "gemini" } }), "Hi.");
    expect(gm.url).toBe("https://h/v1beta/models/gemini-2.5-flash-preview-tts:generateContent");
    expect(body(gm).generationConfig.responseModalities).toEqual(["AUDIO"]);
    const el = speechRequest(t, speechSettings({ speech: { service: "elevenlabs", voice: "abc" } }), "Hi.");
    expect(el.url).toBe("https://h/v1/text-to-speech/abc?output_format=mp3_44100_128");
    expect(body(el)).toEqual({ text: "Hi.", model_id: "eleven_multilingual_v2" });
    const fish = speechRequest(t, speechSettings({ speech: { service: "fish", voice: "ref1" } }), "Hi.");
    expect(fish.headers.model).toBe("s1");
    expect(body(fish)).toEqual({ text: "Hi.", format: "mp3", reference_id: "ref1" });
  });
});

describe("speech audio", () => {
  it("wraps PCM in a valid WAV header", () => {
    const wav = pcmToWav(new Uint8Array(480), 24000);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 480);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(40, true)).toBe(480);
  });

  it("turns Gemini's inline PCM into WAV and passes MP3 through", () => {
    const json = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=16000", data: btoa("\0\0\0\0") } }] } }] });
    const a = decodeSpeech("gemini", new TextEncoder().encode(json));
    expect(a.mime).toBe("audio/wav");
    expect(a.bytes.length).toBe(48);
    expect(new DataView(a.bytes.buffer).getUint32(24, true)).toBe(16000);
    expect(() => decodeSpeech("gemini", new TextEncoder().encode("{}"))).toThrow();
    expect(decodeSpeech("openai", new Uint8Array([1, 2])).mime).toBe("audio/mpeg");
  });
});

describe("speech text", () => {
  it("strips Markdown, citations and code", () => {
    expect(speakable("## Light\n\n**Chlorophyll** absorbs [light](https://x) [1][2].\n\n```js\nx()\n```\n- ATP and `NADPH` [3-4]")).toBe(
      "Light.\nChlorophyll absorbs light.\nATP and NADPH.",
    );
  });

  it("chunks at sentence ends with a short first chunk", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is about photosynthesis and light.`).join(" ");
    const chunks = speechChunks(text, 200, 80);
    expect(chunks[0].length).toBeLessThanOrEqual(80);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.every((c) => c.endsWith("."))).toBe(true);
    expect(chunks.join(" ")).toBe(text);
    expect(speechChunks("word ".repeat(100).trim(), 120).every((c) => c.length <= 120)).toBe(true);
    expect(speechChunks("   ")).toEqual([]);
  });
});
