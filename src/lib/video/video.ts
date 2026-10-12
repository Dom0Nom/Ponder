import { api } from "../ipc";
import type { Slide } from "../studio/kinds";
import { speakable, speechChunks, speechSettings, synthesize } from "../tts/speech";

export const VIDEO_W = 1280;
export const VIDEO_H = 720;
const GAP = 0.6;
const SILENT_SLIDE = 4;

/** What the narrator says for a slide: its speaker notes, else its title and bullets. */
export function narration(slide: Slide): string {
  const notes = slide.notes.trim();
  if (notes) return notes;
  return [slide.title, ...slide.bullets].map((x) => x.trim()).filter(Boolean).join(". ");
}

/** Start and end (seconds) of each slide given its narration length. */
export function schedule(durations: number[], gap = GAP): { start: number; end: number }[] {
  let t = 0;
  return durations.map((d) => {
    const start = t;
    t += (d > 0 ? d : SILENT_SLIDE) + gap;
    return { start, end: t };
  });
}

/** Breaks text into lines no wider than `width`; a single long word gets its own line. */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const MIMES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

export function pickMime(supported: (m: string) => boolean): { mime: string; ext: "mp4" | "webm" } | null {
  const mime = MIMES.find(supported);
  return mime ? { mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" } : null;
}

export interface SlideTheme {
  bg: string;
  fg: string;
  secondary: string;
  muted: string;
  border: string;
  font: string;
}

export function readTheme(): SlideTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return { bg: v("--surface"), fg: v("--text"), secondary: v("--text-secondary"), muted: v("--text-muted"), border: v("--border"), font: getComputedStyle(document.body).fontFamily };
}

export function drawSlide(g: CanvasRenderingContext2D, deck: string, slide: Slide, i: number, n: number, t: SlideTheme) {
  const pad = 96;
  g.fillStyle = t.bg;
  g.fillRect(0, 0, VIDEO_W, VIDEO_H);
  g.textBaseline = "top";
  g.textAlign = "left";
  const width = VIDEO_W - pad * 2;
  if (i === 0 && !slide.bullets.length) {
    g.font = `600 64px ${t.font}`;
    g.fillStyle = t.fg;
    const lines = wrapLines(slide.title, width, (x) => g.measureText(x).width).slice(0, 3);
    let y = VIDEO_H / 2 - (lines.length * 78) / 2;
    for (const l of lines) {
      g.fillText(l, pad, y);
      y += 78;
    }
  } else {
    g.font = `600 48px ${t.font}`;
    g.fillStyle = t.fg;
    let y = 88;
    for (const l of wrapLines(slide.title, width, (x) => g.measureText(x).width).slice(0, 2)) {
      g.fillText(l, pad, y);
      y += 60;
    }
    g.fillStyle = t.border;
    g.fillRect(pad, y + 12, width, 2);
    y += 48;
    g.font = `400 32px ${t.font}`;
    g.fillStyle = t.secondary;
    for (const b of slide.bullets) {
      const lines = wrapLines(b, width - 40, (x) => g.measureText(x).width);
      g.fillText("•", pad, y);
      for (const l of lines) {
        if (y > VIDEO_H - 120) break;
        g.fillText(l, pad + 40, y);
        y += 44;
      }
      y += 14;
    }
  }
  g.font = `500 22px ${t.font}`;
  g.fillStyle = t.muted;
  g.fillText(deck, pad, VIDEO_H - 64);
  g.textAlign = "right";
  g.fillText(`${i + 1} / ${n}`, VIDEO_W - pad, VIDEO_H - 64);
}

/** Records a narrated slideshow in real time: slides drawn on a canvas, narration mixed into the stream (never to the speakers). */
export async function recordVideo(
  deck: string,
  slides: Slide[],
  onProgress: (p: { phase: "voice" | "record"; done: number; total: number }) => void,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; ext: "mp4" | "webm" }> {
  const picked = pickMime((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
  if (!picked) throw new Error("video-unsupported");
  const [settings, providers] = await Promise.all([api.getSettings(), api.listProviders()]);
  const cfg = speechSettings(settings);
  const ctx = new AudioContext();
  try {
    const clips: AudioBuffer[][] = [];
    for (const [i, slide] of slides.entries()) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const parts: AudioBuffer[] = [];
      for (const text of speechChunks(speakable(narration(slide)))) {
        const a = await synthesize(cfg, text, providers);
        parts.push(await ctx.decodeAudioData(a.bytes.slice().buffer));
      }
      clips.push(parts);
      onProgress({ phase: "voice", done: i + 1, total: slides.length });
    }
    const times = schedule(clips.map((c) => c.reduce((n, b) => n + b.duration, 0)));
    const total = times[times.length - 1]?.end ?? 0;

    const canvas = document.createElement("canvas");
    canvas.width = VIDEO_W;
    canvas.height = VIDEO_H;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("video-unsupported");
    const theme = readTheme();
    const dest = ctx.createMediaStreamDestination();
    const stream = canvas.captureStream(30);
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
    const rec = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()));

    if (ctx.state === "suspended") await ctx.resume();
    drawSlide(g, deck, slides[0], 0, slides.length, theme);
    rec.start(1000);
    const lead = 0.25;
    const t0 = ctx.currentTime + lead;
    const w0 = performance.now() + lead * 1000;
    clips.forEach((parts, i) => {
      let at = t0 + times[i].start;
      for (const buf of parts) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(dest);
        src.start(at);
        at += buf.duration;
      }
    });
    await new Promise<void>((resolve, reject) => {
      let shown = -1;
      const tick = window.setInterval(() => {
        if (signal?.aborted) {
          window.clearInterval(tick);
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        const now = (performance.now() - w0) / 1000;
        const i = Math.max(0, times.findIndex((x) => now < x.end));
        if (now >= total) {
          window.clearInterval(tick);
          resolve();
          return;
        }
        // repaint every tick so the stream keeps producing frames on a still slide
        drawSlide(g, deck, slides[i], i, slides.length, theme);
        if (i !== shown) {
          shown = i;
          onProgress({ phase: "record", done: Math.floor(now), total: Math.ceil(total) });
        }
      }, 100);
    }).finally(() => rec.state !== "inactive" && rec.stop());
    await stopped;
    const blob = new Blob(chunks, { type: picked.mime });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: picked.ext };
  } finally {
    void ctx.close().catch(() => {});
  }
}
