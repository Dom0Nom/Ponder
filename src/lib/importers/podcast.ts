/** Podcast RSS feeds: list episodes, then import one from its published transcript or by transcribing the audio. */

export interface Episode {
  id: string;
  title: string;
  date: number | null;
  audioUrl: string | null;
  audioType: string;
  audioBytes: number | null;
  durationSec: number | null;
  transcripts: { url: string; type: string }[];
  link: string | null;
}

export interface Feed {
  title: string;
  episodes: Episode[];
}

function decode(s: string): string {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
};

const attr = (el: string, name: string) => {
  const m = el.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[2] ?? m[3] ?? "") : null;
};

export function parseDuration(v: string | null): number | null {
  if (!v) return null;
  const parts = v.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function isFeed(body: string): boolean {
  return /<rss\b|<feed\b[^>]*Atom/i.test(body.slice(0, 2000)) && /<item\b|<entry\b/i.test(body);
}

export function parseFeed(xml: string): Feed {
  const channel = xml.split(/<item\b/i)[0];
  const title = tag(channel, "title") ?? "Podcast";
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const episodes = items.map((it, i): Episode => {
    const enclosure = it.match(/<enclosure\b[^>]*>/i)?.[0] ?? "";
    const transcripts = (it.match(/<podcast:transcript\b[^>]*>/gi) ?? [])
      .map((el) => ({ url: attr(el, "url") ?? "", type: (attr(el, "type") ?? "").toLowerCase() }))
      .filter((t) => t.url);
    const date = Date.parse(tag(it, "pubDate") ?? "");
    const bytes = Number(attr(enclosure, "length"));
    return {
      id: tag(it, "guid") ?? attr(enclosure, "url") ?? String(i),
      title: tag(it, "title") ?? `Episode ${items.length - i}`,
      date: Number.isFinite(date) ? date : null,
      audioUrl: attr(enclosure, "url"),
      audioType: (attr(enclosure, "type") ?? "").toLowerCase(),
      audioBytes: bytes > 0 ? bytes : null,
      durationSec: parseDuration(tag(it, "itunes:duration")),
      transcripts,
      link: tag(it, "link"),
    };
  });
  return { title, episodes };
}

/** Prefers the formats that keep timing (VTT/SRT/JSON), then HTML, then plain text. */
export function pickTranscript(ep: Episode): { url: string; type: string } | null {
  const rank = (t: string) => (/vtt|srt|subrip/.test(t) ? 0 : /json/.test(t) ? 1 : /html/.test(t) ? 2 : /text/.test(t) ? 3 : 9);
  return [...ep.transcripts].sort((a, b) => rank(a.type) - rank(b.type)).find((t) => rank(t.type) < 9) ?? null;
}

const mark = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

const cueTime = (t: string) => {
  const m = t.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

/** Joins cues into paragraphs of about a minute, each with a time mark. */
function paragraphs(cues: { start: number; text: string }[], every = 60): string {
  const out: string[] = [];
  let cur: string[] = [];
  let at = 0;
  for (const c of cues) {
    if (!cur.length) at = c.start;
    if (c.text) cur.push(c.text);
    if (c.start - at >= every && cur.length) {
      out.push(`[${mark(at)}] ${cur.join(" ")}`);
      cur = [];
    }
  }
  if (cur.length) out.push(`[${mark(at)}] ${cur.join(" ")}`);
  return out.join("\n\n");
}

export function transcriptText(body: string, type: string): string {
  if (/vtt|srt|subrip/.test(type) || /^WEBVTT/.test(body.trimStart())) {
    const cues = body
      .replace(/\r/g, "")
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block.split("\n");
        const i = lines.findIndex((l) => l.includes("-->"));
        if (i < 0) return null;
        const text = lines
          .slice(i + 1)
          .join(" ")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        return { start: cueTime(lines[i].split("-->")[0]), text: decode(text) };
      })
      .filter((c): c is { start: number; text: string } => !!c);
    return paragraphs(cues);
  }
  if (/json/.test(type)) {
    const j = JSON.parse(body) as { segments?: { startTime?: number; body?: string; speaker?: string }[] };
    return paragraphs((j.segments ?? []).map((x) => ({ start: x.startTime ?? 0, text: (x.body ?? "").trim() })));
  }
  if (/html/.test(type)) {
    return decode(
      body
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
        .replace(/<\/(p|div|h\d|li)>|<br\s*\/?>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n"),
    );
  }
  return body.trim();
}

/**
 * Splits MP3 audio into pieces of about `size` bytes, each starting on a frame header, so every
 * piece decodes on its own.
 */
export function splitMp3(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + size);
    if (end < bytes.length) {
      let i = end;
      while (i < bytes.length - 1 && !(bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0)) i++;
      end = i >= bytes.length - 1 ? bytes.length : i;
    }
    out.push(bytes.subarray(start, end));
    start = end;
  }
  return out;
}

export const MAX_AUDIO_BYTES = 150 * 1024 * 1024;
export const PIECE_BYTES = 8 * 1024 * 1024;

export function audioFormat(type: string, url: string): "mp3" | "m4a" | "ogg" | "wav" | "aac" | "flac" | null {
  return formatIn(type.toLowerCase()) ?? formatIn(url.split("?")[0].toLowerCase().split("/").pop() ?? "");
}

function formatIn(t: string): ReturnType<typeof audioFormat> {
  if (/mpeg|mp3/.test(t)) return "mp3";
  if (/m4a|mp4/.test(t)) return "m4a";
  if (/aac/.test(t)) return "aac";
  if (/ogg|opus/.test(t)) return "ogg";
  if (/wav/.test(t)) return "wav";
  if (/flac/.test(t)) return "flac";
  return null;
}

export interface PodcastDeps {
  getText: (url: string) => Promise<string>;
  getBytes: (url: string) => Promise<Uint8Array>;
  transcribe: (audio: Uint8Array, format: NonNullable<ReturnType<typeof audioFormat>>) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
}

export class PodcastError extends Error {}

/** Episode text: the feed's transcript when there is one, else the audio transcribed piece by piece. */
export async function episodeText(ep: Episode, deps: PodcastDeps): Promise<{ text: string; transcribed: boolean }> {
  const t = pickTranscript(ep);
  if (t) {
    try {
      const text = transcriptText(await deps.getText(t.url), t.type);
      if (text.length > 50) return { text, transcribed: false };
    } catch {
      /* fall back to the audio */
    }
  }
  if (!ep.audioUrl) throw new PodcastError("noAudio");
  const format = audioFormat(ep.audioType, ep.audioUrl);
  if (!format) throw new PodcastError("format");
  if (ep.audioBytes && ep.audioBytes > MAX_AUDIO_BYTES) throw new PodcastError("tooLong");
  const audio = await deps.getBytes(ep.audioUrl);
  if (audio.length > MAX_AUDIO_BYTES) throw new PodcastError("tooLong");
  const pieces = format === "mp3" ? splitMp3(audio, PIECE_BYTES) : [audio];
  if (format !== "mp3" && audio.length > PIECE_BYTES * 3) throw new PodcastError("tooLongUnsplit");
  const perByte = ep.durationSec ? ep.durationSec / audio.length : null;
  const parts: string[] = [];
  let offset = 0;
  for (let i = 0; i < pieces.length; i++) {
    deps.onProgress?.(i, pieces.length);
    const text = (await deps.transcribe(pieces[i], format)).trim();
    if (text) parts.push(perByte ? `[${mark(offset * perByte)}] ${text}` : text);
    offset += pieces[i].length;
  }
  deps.onProgress?.(pieces.length, pieces.length);
  return { text: parts.join("\n\n"), transcribed: true };
}
