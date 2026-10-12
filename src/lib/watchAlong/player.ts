/** Talks to a YouTube embed over postMessage (the IFrame API's wire protocol), so no YouTube script runs in the app. */
export const EMBED_ORIGIN = "https://www.youtube-nocookie.com";

export function embedUrl(videoId: string, start = 0) {
  const q = new URLSearchParams({ enablejsapi: "1", rel: "0", playsinline: "1", start: String(Math.floor(start)) });
  return `${EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?${q}`;
}

export interface PlayerInfo {
  time?: number;
  /** -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued */
  state?: number;
  duration?: number;
  ready?: boolean;
}

/** Reads one message from the embed; null when it isn't from the player. */
export function readPlayerMessage(origin: string, data: unknown): PlayerInfo | null {
  if (origin !== EMBED_ORIGIN) return null;
  let o: unknown = data;
  if (typeof data === "string") {
    try {
      o = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const msg = o as { event?: string; info?: Record<string, unknown> | number };
  if (msg.event === "onReady") return { ready: true };
  if (msg.event === "onStateChange" && typeof msg.info === "number") return { state: msg.info };
  if (msg.event === "infoDelivery" && msg.info && typeof msg.info === "object") {
    const i = msg.info;
    const out: PlayerInfo = {};
    if (typeof i.currentTime === "number") out.time = i.currentTime;
    if (typeof i.playerState === "number") out.state = i.playerState;
    if (typeof i.duration === "number") out.duration = i.duration;
    return out;
  }
  return null;
}

export function command(frame: HTMLIFrameElement | null, func: "playVideo" | "pauseVideo" | "seekTo", args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), EMBED_ORIGIN);
}

/** Asks the embed to start sending time updates. */
export function listen(frame: HTMLIFrameElement | null) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), EMBED_ORIGIN);
}
