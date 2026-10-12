import { create } from "zustand";
import { api } from "../ipc";
import { speakable, speechChunks, speechSettings, synthesize, type Audio } from "./speech";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

export const usePlayer = create<{ key: string | null; status: PlayerStatus }>(() => ({ key: null, status: "idle" }));

let run = 0;
let current: HTMLAudioElement | null = null;
let finishClip: (() => void) | null = null;

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
  usePlayer.setState({ key: null, status: "idle" });
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
      () => my === run && usePlayer.setState({ status: "playing" }),
      (e) => (my === run ? reject(e) : resolve()),
    );
  });
}

/**
 * Reads `text` (Markdown is fine) aloud. Synthesizes sentence chunks one ahead of playback,
 * so long answers start quickly. A new call or `stopSpeaking` cancels the previous one.
 */
export async function speak(key: string, text: string): Promise<void> {
  stopSpeaking();
  const my = run;
  const chunks = speechChunks(speakable(text));
  if (!chunks.length) return;
  usePlayer.setState({ key, status: "loading" });
  try {
    const [settings, providers] = await Promise.all([api.getSettings(), api.listProviders()]);
    const cfg = speechSettings(settings);
    const pending: Promise<Audio>[] = [];
    const prefetch = (i: number) => {
      if (i < chunks.length && !pending[i]) {
        pending[i] = synthesize(cfg, chunks[i], providers);
        pending[i].catch(() => undefined);
      }
    };
    for (let i = 0; i < chunks.length; i++) {
      prefetch(i);
      prefetch(i + 1);
      const clip = await pending[i];
      if (my !== run) return;
      await playClip(clip, cfg.speed, my);
      if (my !== run) return;
    }
  } catch (e) {
    if (my === run) throw e;
  } finally {
    if (my === run) stopSpeaking();
  }
}
