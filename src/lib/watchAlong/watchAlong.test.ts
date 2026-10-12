import { describe, expect, it } from "vitest";
import { transcriptToMarkdown } from "../importers/youtube";
import { checkpoints, clock, feedbackPrompt, parseFeedback, parseQuestion, parseTranscript, questionPrompt } from "./watchAlong";
import { embedUrl, readPlayerMessage } from "./player";

const cues = Array.from({ length: 20 }, (_, i) => ({ start: i * 50, text: `Part ${i}.` }));
const md = transcriptToMarkdown("Cells", "https://www.youtube.com/watch?v=abcdefghijk", cues);

describe("watch-along", () => {
  it("reads the video id and timed segments from an imported transcript", () => {
    const t = parseTranscript(md);
    expect(t.videoId).toBe("abcdefghijk");
    expect(t.segments).toHaveLength(20);
    expect(t.segments[3]).toEqual({ sec: 150, text: "Part 3." });
    expect(parseTranscript("[1:02:03] Late part").segments[0].sec).toBe(3723);
    expect(parseTranscript("No stamps here").segments).toEqual([]);
  });

  it("pauses every few minutes and folds a short tail into the last stretch", () => {
    const cps = checkpoints(parseTranscript(md).segments, 240);
    expect(cps.map((c) => c.at)).toEqual([250, 500, 750, 995]);
    expect(cps[0]).toMatchObject({ from: 0, text: "Part 0. Part 1. Part 2. Part 3. Part 4." });
    expect(cps[3].from).toBe(750);
    expect(checkpoints([{ sec: 0, text: "a" }])).toEqual([{ at: 45, from: 0, text: "a" }]);
    expect(checkpoints([])).toEqual([]);
  });

  it("formats clock times", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(3723)).toBe("1:02:03");
  });

  it("builds prompts and parses the model's JSON", () => {
    const cp = { at: 250, from: 0, text: "Cells divide." };
    expect(questionPrompt("Cells", cp, ["Old?"])).toContain("- Old?");
    expect(questionPrompt("Cells", cp, []).split("\n")[0]).toContain("reached 4:10");
    expect(parseQuestion('```json\n{"question": " Why? ", "answer": "Because."}\n```')).toEqual({ question: "Why?", answer: "Because." });
    expect(parseQuestion('{"answer": "x"}')).toBeNull();
    expect(feedbackPrompt(cp, { question: "Q", answer: "" }, "mine")).not.toContain("MODEL ANSWER");
    expect(parseFeedback('{"correct": false, "feedback": "Close."}')).toEqual({ correct: false, feedback: "Close." });
    expect(parseFeedback('{"feedback": "x"}')).toBeNull();
  });

  it("reads player messages only from the embed origin", () => {
    const o = "https://www.youtube-nocookie.com";
    expect(readPlayerMessage(o, '{"event":"infoDelivery","info":{"currentTime":12.5,"playerState":1}}')).toEqual({ time: 12.5, state: 1 });
    expect(readPlayerMessage(o, '{"event":"onReady"}')).toEqual({ ready: true });
    expect(readPlayerMessage(o, { event: "onStateChange", info: 2 })).toEqual({ state: 2 });
    expect(readPlayerMessage("https://evil.example", '{"event":"onReady"}')).toBeNull();
    expect(readPlayerMessage(o, "not json")).toBeNull();
    expect(embedUrl("abc", 61.7)).toBe("https://www.youtube-nocookie.com/embed/abc?enablejsapi=1&rel=0&playsinline=1&start=61");
  });
});
