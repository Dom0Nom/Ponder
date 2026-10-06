import { describe, expect, it } from "vitest";
import { fetchTranscript, parseTimedText, pickTrack, transcriptToMarkdown, youTubeId, type HttpFn } from "./youtube";

describe("youtube", () => {
  it("extracts ids from all common URL shapes", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("parses both timedtext formats and decodes entities", () => {
    expect(parseTimedText('<transcript><text start="1.5" dur="2">it&amp;#39;s &lt;b&gt;</text></transcript>')).toEqual([
      { start: 1.5, text: "it's <b>" },
    ]);
    expect(parseTimedText('<timedtext><body><p t="61000" d="900"><s>hello</s> world</p></body></timedtext>')).toEqual([
      { start: 61, text: "hello world" },
    ]);
  });

  it("prefers manual captions in the preferred language", () => {
    const t = pickTrack(
      [
        { baseUrl: "a", languageCode: "en", kind: "asr" },
        { baseUrl: "b", languageCode: "de" },
        { baseUrl: "c", languageCode: "en" },
      ],
      ["en"],
    );
    expect(t?.baseUrl).toBe("c");
  });

  it("groups cues into timestamped paragraphs", () => {
    const md = transcriptToMarkdown("T", "u", [
      { start: 0, text: "a" },
      { start: 30, text: "b" },
      { start: 50, text: "c" },
    ]);
    expect(md).toContain("[0:00] a b");
    expect(md).toContain("[0:50] c");
  });

  it("runs the whole flow against a fake YouTube and reports missing captions clearly", async () => {
    const http: (tracks: unknown[]) => HttpFn = (tracks) => async (url) => {
      if (url.includes("/watch")) return { status: 200, body: '<title>Video - YouTube</title>"INNERTUBE_API_KEY":"KEY"' };
      if (url.includes("/player")) {
        return {
          status: 200,
          body: JSON.stringify({
            playabilityStatus: { status: "OK" },
            videoDetails: { title: "Cells" },
            captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
          }),
        };
      }
      return { status: 200, body: '<text start="0" dur="1">Cells are small.</text>' };
    };
    const ok = await fetchTranscript("dQw4w9WgXcQ", http([{ baseUrl: "https://x/tt?fmt=srv3", languageCode: "en" }]), ["en"]);
    expect(ok.title).toBe("Cells");
    expect(ok.markdown).toContain("Cells are small.");
    await expect(fetchTranscript("dQw4w9WgXcQ", http([]), ["en"])).rejects.toThrow("no captions");
  });
});
