import { create } from "zustand";
import { api } from "../ipc";
import { speakable, speechChunks, speechSettings, synthesize, type Audio, type SpeechSettings } from "./speech";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

export const usePlayer = create<{ key: string | null; status: PlayerStatus; segment: number }>(() => ({ key: null, status: "idle", segment: 0 }));

export interface Segment {
  text: string;
  /** 1 uses the second voice. */
  voice?: 0 | 1;
}

let run = 0;
let current: HTMLAudioElement | null = null;
let finishClip: (() => void) | null = null;
let wakeLive: (() => void) | null = null;

function release() {
  if (current) {
    current.pause();
    URL.revokeObjectURL(current.src);
  }
  current = null;
  finishClip?.();
  finishClip = null;
}

export function stopSpeaking() {
  run++;
  release();
  wakeLive?.();
  usePlayer.setState({ key: null, status: "idle", segment: 0 });
}

export function pauseSpeaking() {
  if (!current || usePlayer.getState().status !== "playing") return;
  current.pause();
  usePlayer.setState({ status: "paused" });
}

export function resumeSpeaking() {
  if (!current || usePlayer.getState().status !== "paused") return;
  void current.play();
  usePlayer.setState({ status: "playing" });
}

function playClip(clip: Audio, speed: number, my: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = new window.Audio(URL.createObjectURL(new Blob([clip.bytes as BlobPart], { type: clip.mime })));
    el.playbackRate = speed;
    el.preservesPitch = true;
    current = el;
    finishClip = resolve;
    const done = () => {
      if (current === el) release();
      resolve();
    };
    el.addEventListener("ended", done, { once: true });
    el.addEventListener("error", () => (my === run ? reject(new Error(el.error?.message || "audio error")) : resolve()), { once: true });
    el.play().then(
      () => my === run && usePlayer.getState().status !== "paused" && usePlayer.setState({ status: "playing" }),
      (e) => (my === run ? reject(e) : resolve()),
    );
  });
}

export const voiceFor = (cfg: SpeechSettings, voice: 0 | 1 | undefined): SpeechSettings =>
  voice === 1 && cfg.voice2 && cfg.voice2 !== cfg.voice ? { ...cfg, voice: cfg.voice2 } : cfg;

/**
 * Plays segments in order from `start`, synthesizing sentence chunks one ahead of playback so long text starts
 * quickly. A new call or `stopSpeaking` cancels the previous one. Resolves when playback ends or is cancelled.
 */
/** Resolves true when every segment played, false when stopped or replaced. */
export async function speakSegments(key: string, segments: Segment[], start = 0): Promise<boolean> {
  stopSpeaking();
  const my = run;
  const queue = segments.slice(start).flatMap((seg, i) => speechChunks(speakable(seg.text)).map((text) => ({ text, voice: seg.voice, segment: start + i })));
  if (!queue.length) return true;
  usePlayer.setState({ key, status: "loading", segment: queue[0].segment });
  try {
    const [settings, providers] = await Promise.all([api.getSettings(), api.listProviders()]);
    const cfg = speechSettings(settings);
    const pending: Promise<Audio>[] = [];
    const prefetch = (i: number) => {
      if (i < queue.length && !pending[i]) {
        pending[i] = synthesize(voiceFor(cfg, queue[i].voice), queue[i].text, providers);
        pending[i].catch(() => undefined);
      }
    };
    for (let i = 0; i < queue.length; i++) {
      prefetch(i);
      prefetch(i + 1);
      const clip = await pending[i];
      if (my !== run) return false;
      usePlayer.setState({ segment: queue[i].segment });
      await playClip(clip, cfg.speed, my);
      if (my !== run) return false;
    }
    return true;
  } catch (e) {
    if (my === run) throw e;
    return false;
  } finally {
    if (my === run) stopSpeaking();
  }
}

export const speak = (key: string, text: string) => speakSegments(key, [{ text }]);

export interface LiveSpeaker {
  push: (text: string) => void;
  /** No more text is coming. */
  end: () => void;
  /** True when everything pushed was played, false when stopped or replaced. */
  done: Promise<boolean>;
}

/** Speaks text as it arrives. Text pushed while a clip plays is joined into the next clip. */
export function speakLive(key: string): LiveSpeaker {
  stopSpeaking();
  const my = run;
  let buffer = "";
  let ended = false;
  const take = () => {
    const [head, ...rest] = speechChunks(buffer, 600, 600);
    buffer = rest.join(" ");
    return head ?? "";
  };
  usePlayer.setState({ key, status: "loading", segment: 0 });
  const done = (async () => {
    try {
      const [settings, providers] = await Promise.all([api.getSettings(), api.listProviders()]);
      const cfg = speechSettings(settings);
      const next = () => {
        const p = synthesize(cfg, take(), providers);
        p.catch(() => undefined);
        return p;
      };
      let clip: Promise<Audio> | null = null;
      for (;;) {
        while (!clip && !buffer.trim() && !ended && my === run) {
          await new Promise<void>((resolve) => {
            const w = () => {
              if (wakeLive === w) wakeLive = null;
              resolve();
            };
            wakeLive = w;
          });
        }
        if (my !== run) return false;
        if (!clip) {
          if (!buffer.trim()) return true;
          clip = next();
        }
        const audio = await clip;
        if (my !== run) return false;
        clip = buffer.trim() ? next() : null;
        await playClip(audio, cfg.speed, my);
        if (my !== run) return false;
      }
    } catch (e) {
      if (my === run) throw e;
      return false;
    } finally {
      if (my === run) stopSpeaking();
    }
  })();
  done.catch(() => undefined);
  return {
    push: (text) => {
      if (my !== run || ended) return;
      buffer = buffer ? `${buffer} ${text}` : text;
      wakeLive?.();
    },
    end: () => {
      ended = true;
      wakeLive?.();
    },
    done,
  };
}

/** Renders segments to one MP3 file without playing them. Gemini returns WAV clips, which can't be joined this way. */
export async function renderSegments(segments: Segment[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const [settings, providers] = await Promise.all([api.getSettings(), api.listProviders()]);
  const cfg = speechSettings(settings);
  const queue = segments.flatMap((seg) => speechChunks(speakable(seg.text)).map((text) => ({ text, voice: seg.voice })));
  const parts: Uint8Array[] = [];
  for (const [i, q] of queue.entries()) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const clip = await synthesize(voiceFor(cfg, q.voice), q.text, providers);
    if (clip.mime !== "audio/mpeg") throw new Error("mp3");
    parts.push(clip.bytes);
    onProgress?.(i + 1, queue.length);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
