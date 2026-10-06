import { describe, expect, it } from "vitest";
import { parsePlaylistUri } from "./music";

const ID = "37i9dQZF1DXcBWIGoYBM5M";

describe("parsePlaylistUri", () => {
  it("accepts URIs and links", () => {
    for (const input of [
      `spotify:playlist:${ID}`,
      `  https://open.spotify.com/playlist/${ID}?si=abc  `,
      `open.spotify.com/intl-de/playlist/${ID}`,
      `http://www.open.spotify.com/playlist/${ID}/`,
    ]) {
      expect(parsePlaylistUri(input)).toEqual({ ok: true, uri: `spotify:playlist:${ID}` });
    }
  });

  it("accepts albums", () => {
    expect(parsePlaylistUri(`https://open.spotify.com/album/${ID}`)).toEqual({ ok: true, uri: `spotify:album:${ID}` });
  });

  it("rejects everything else", () => {
    for (const input of [
      "",
      "hello",
      `https://example.com/playlist/${ID}`,
      `https://open.spotify.com.evil.com/playlist/${ID}`,
      `https://open.spotify.com/track/${ID}`,
      "spotify:playlist:short",
      `spotify:playlist:${ID}:extra`,
    ]) {
      expect(parsePlaylistUri(input).ok, input).toBe(false);
    }
  });
});
