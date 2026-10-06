import { s } from "./strings";

export type PlaylistParse = { ok: true; uri: string } | { ok: false; error: string };

const ID = /^[A-Za-z0-9]{10,40}$/;

/** Mirrors the Rust parser: playlist/album URIs and open.spotify.com links. */
export function parsePlaylistUri(input: string): PlaylistParse {
  const text = input.trim();
  if (!text) return { ok: false, error: s.music.errEmpty };
  let parts: string[];
  if (text.startsWith("spotify:")) {
    parts = text.slice("spotify:".length).split(":");
  } else {
    const m = /^(?:https?:\/\/)?(?:www\.)?open\.spotify\.com\/([^?#]*)/.exec(text);
    if (!m) return { ok: false, error: s.music.errNotSpotify };
    parts = m[1].split("/").filter(Boolean);
    if (parts[0]?.startsWith("intl-")) parts.shift();
  }
  const [kind, id] = parts;
  if (parts.length === 2 && (kind === "playlist" || kind === "album") && ID.test(id)) {
    return { ok: true, uri: `spotify:${kind}:${id}` };
  }
  return { ok: false, error: s.music.errBad };
}
