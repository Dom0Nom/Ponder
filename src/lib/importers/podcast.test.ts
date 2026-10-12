import { describe, expect, it } from "vitest";
import { audioFormat, episodeText, isFeed, parseFeed, pickTranscript, splitMp3, transcriptText, type Episode } from "./podcast";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel><title><![CDATA[Bio &amp; Beyond]]></title>
<item><title>Ep 2: Light reactions</title><guid>ep2</guid><pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate>
<enclosure url="https://cdn.example/ep2.mp3?x=1&amp;y=2" length="1234567" type="audio/mpeg"/>
<itunes:duration>01:02:03</itunes:duration>
<podcast:transcript url="https://cdn.example/ep2.html" type="text/html"/>
<podcast:transcript url="https://cdn.example/ep2.vtt" type="text/vtt"/>
</item>
<item><title>Ep 1</title><enclosure url="https://cdn.example/ep1.m4a" type="audio/x-m4a"/><itunes:duration>754</itunes:duration></item>
</channel></rss>`;

describe("podcast feeds", () => {
  it("parses episodes, enclosures and transcripts", () => {
    expect(isFeed(FEED)).toBe(true);
    expect(isFeed("<html><body>hi</body></html>")).toBe(false);
    const f = parseFeed(FEED);
    expect(f.title).toBe("Bio & Beyond");
    expect(f.episodes).toHaveLength(2);
    const [a, b] = f.episodes;
    expect(a).toMatchObject({ id: "ep2", title: "Ep 2: Light reactions", audioUrl: "https://cdn.example/ep2.mp3?x=1&y=2", audioBytes: 1234567, durationSec: 3723, audioType: "audio/mpeg" });
    expect(a.date).toBe(Date.parse("2026-10-06T08:00:00Z"));
    expect(pickTranscript(a)?.url).toBe("https://cdn.example/ep2.vtt");
    expect(b).toMatchObject({ title: "Ep 1", durationSec: 754, transcripts: [], audioBytes: null });
  });

  it("turns VTT, SRT, JSON and HTML transcripts into paragraphs with time marks", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Ana>Light hits the leaf.\n\n00:00:30.500 --> 00:00:33.000\nWater splits.\n\n00:01:05.000 --> 00:01:08.000\nOxygen leaves.";
    expect(transcriptText(vtt, "text/vtt")).toBe("[0:01] Light hits the leaf. Water splits. Oxygen leaves.");
    const srt = "1\n00:00:00,000 --> 00:00:02,000\nOne.\n\n2\n00:01:10,000 --> 00:01:12,000\nTwo.\n\n3\n00:01:20,000 --> 00:01:22,000\nThree.";
    expect(transcriptText(srt, "application/srt")).toBe("[0:00] One. Two.\n\n[1:20] Three.");
    expect(transcriptText(JSON.stringify({ segments: [{ startTime: 3, body: "Hi" }, { startTime: 3700, body: "Bye" }] }), "application/json")).toBe("[0:03] Hi Bye");
    expect(transcriptText("<html><body><p>First &amp; one.</p><p>Second</p><script>x()</script></body></html>", "text/html")).toBe("First & one.\n\nSecond");
  });

  it("splits MP3 on frame headers", () => {
    const bytes = new Uint8Array(100);
    for (const i of [0, 30, 61, 90]) [bytes[i], bytes[i + 1]] = [0xff, 0xfb];
    const parts = splitMp3(bytes, 25);
    expect(parts.map((p) => p.length)).toEqual([30, 31, 29, 10]);
    expect(parts.slice(1).every((p) => p[0] === 0xff && (p[1] & 0xe0) === 0xe0)).toBe(true);
  });

  it("uses the transcript when there is one, else transcribes the audio in pieces", async () => {
    const ep = parseFeed(FEED).episodes[0];
    const calls: string[] = [];
    const deps = {
      getText: async (url: string) => (calls.push(url), "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nThe light reactions happen in the thylakoid membranes of the chloroplast."),
      getBytes: async () => new Uint8Array(0),
      transcribe: async () => "never",
    };
    expect(await episodeText(ep, deps)).toEqual({ text: "[0:00] The light reactions happen in the thylakoid membranes of the chloroplast.", transcribed: false });
    expect(calls).toEqual(["https://cdn.example/ep2.vtt"]);

    const audio = new Uint8Array(20 * 1024 * 1024);
    audio[9 * 1024 * 1024] = 0xff;
    audio[9 * 1024 * 1024 + 1] = 0xfb;
    const noT: Episode = { ...ep, transcripts: [], durationSec: 2000 };
    const seen: number[] = [];
    const r = await episodeText(noT, { ...deps, getBytes: async () => audio, transcribe: async (a) => (seen.push(a.length), `part ${seen.length}`) });
    expect(seen).toEqual([9 * 1024 * 1024, 11 * 1024 * 1024]);
    expect(r).toEqual({ text: "[0:00] part 1\n\n[15:00] part 2", transcribed: true });

    await expect(episodeText({ ...noT, audioBytes: 500 * 1024 * 1024 }, deps)).rejects.toThrow("tooLong");
    await expect(episodeText({ ...noT, audioUrl: null }, deps)).rejects.toThrow("noAudio");
  });
});

describe("audioFormat", () => {
  it("trusts the MIME type over the file name", () => {
    expect(audioFormat("audio/ogg", "https://cdn.example.com/ep.mp3")).toBe("ogg");
    expect(audioFormat("audio/mp4", "https://cdn.example.com/mp3/ep")).toBe("m4a");
  });
  it("falls back to the file extension, ignoring the path and query", () => {
    expect(audioFormat("", "https://example.com/mp3s/ep.m4a?x=wav")).toBe("m4a");
    expect(audioFormat("application/octet-stream", "https://example.com/ep.flac")).toBe("flac");
    expect(audioFormat("", "https://example.com/ep")).toBeNull();
  });
});
