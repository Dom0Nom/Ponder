/**
 * YouTube transcripts. Unofficial (YouTube has no public transcript API) and can break whenever
 * YouTube changes its player; everything is isolated here and fails with a clear message.
 */
import { api } from "../ipc";
import type { Source } from "../types";
import type { Importer } from "./types";

export function youTubeId(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.searchParams.get("v")) return u.searchParams.get("v")!.slice(0, 11);
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    return null;
  }
  return null;
}

export const isYouTubeUrl = (input: string) => youTubeId(input) != null;

export class TranscriptError extends Error {}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

export type HttpFn = (
  url: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; body: string }>;

/** Picks the best caption track: manual over auto-generated, preferred languages first. */
export function pickTrack(tracks: CaptionTrack[], prefer: string[]): CaptionTrack | null {
  if (!tracks.length) return null;
  const score = (t: CaptionTrack) => {
    const lang = prefer.findIndex((p) => t.languageCode.toLowerCase().startsWith(p.toLowerCase()));
    return (lang === -1 ? 100 : lang * 10) + (t.kind === "asr" ? 5 : 0);
  };
  return [...tracks].sort((a, b) => score(a) - score(b))[0];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export interface Cue {
  start: number;
  text: string;
}

/** Parses both timedtext XML formats (`<text start dur>` and srv3 `<p t d>`). */
export function parseTimedText(xml: string): Cue[] {
  const cues: Cue[] = [];
  const re = /<text[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>|<p[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  for (const m of xml.matchAll(re)) {
    const start = m[1] != null ? Number(m[1]) : Number(m[3]) / 1000;
    const text = decodeEntities(decodeEntities((m[2] ?? m[4] ?? "").replace(/<[^>]+>/g, "")))
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start, text });
  }
  return cues;
}

const stamp = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** Groups cues into ~45 s paragraphs with a timestamp each, so citations land on a moment. */
export function transcriptToMarkdown(title: string, url: string, cues: Cue[]): string {
  const paras: string[] = [];
  let cur: string[] = [];
  let curStart = cues[0]?.start ?? 0;
  for (const c of cues) {
    if (cur.length && c.start - curStart >= 45) {
      paras.push(`[${stamp(curStart)}] ${cur.join(" ")}`);
      cur = [];
      curStart = c.start;
    }
    cur.push(c.text);
  }
  if (cur.length) paras.push(`[${stamp(curStart)}] ${cur.join(" ")}`);
  return `# ${title}\n\nYouTube: ${url}\n\n${paras.join("\n\n")}`;
}

const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38" };

export async function fetchTranscript(
  videoId: string,
  http: HttpFn,
  prefer: string[] = [navigator.language.split("-")[0], "en"],
): Promise<{ title: string; markdown: string }> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const page = await http(watchUrl, { method: "GET", headers: { "Accept-Language": "en-US,en;q=0.9" } });
  if (page.status >= 400) throw new TranscriptError(`YouTube returned HTTP ${page.status}.`);
  const key = page.body.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/)?.[1];
  const htmlTitle = decodeEntities(page.body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").replace(/ - YouTube$/, "").trim();
  if (!key) throw new TranscriptError("YouTube's page format changed; transcripts can't be read right now.");

  const player = await http(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { ...ANDROID_CLIENT, hl: "en" } }, videoId }),
  });
  if (player.status >= 400) throw new TranscriptError(`YouTube's player API returned HTTP ${player.status}.`);
  let data: {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  };
  try {
    data = JSON.parse(player.body);
  } catch {
    throw new TranscriptError("YouTube sent an unexpected response.");
  }
  const status = data.playabilityStatus?.status;
  if (status && status !== "OK") {
    throw new TranscriptError(`This video can't be read: ${data.playabilityStatus?.reason ?? status}.`);
  }
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  // the auto-generated track reveals the spoken language; prefer it over translations
  const spoken = tracks.find((t) => t.kind === "asr")?.languageCode;
  const track = pickTrack(tracks, spoken ? [spoken, ...prefer] : prefer);
  if (!track) throw new TranscriptError("This video has no captions or transcript.");
  const xml = await http(track.baseUrl.replace(/&fmt=[^&]+/, ""), { method: "GET" });
  if (xml.status >= 400 || !xml.body.trim()) throw new TranscriptError("YouTube didn't return the transcript.");
  const cues = parseTimedText(xml.body);
  if (!cues.length) throw new TranscriptError("The transcript is empty.");
  const title = data.videoDetails?.title || htmlTitle || `YouTube video ${videoId}`;
  return { title, markdown: transcriptToMarkdown(title, watchUrl, cues) };
}

export const youtubeImporter = (http: HttpFn): Importer<string> => ({
  id: "youtube",
  canHandle: isYouTubeUrl,
  async import(spaceId, input): Promise<Source> {
    const id = youTubeId(input);
    if (!id) throw new TranscriptError("That isn't a YouTube link.");
    const { title, markdown } = await fetchTranscript(id, http);
    return api.importText(spaceId, title, markdown, "youtube", `https://www.youtube.com/watch?v=${id}`);
  },
});
