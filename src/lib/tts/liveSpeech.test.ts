import { describe, expect, it } from "vitest";
import { LiveSpeech, speechCut } from "./liveSpeech";

function feed(chunks: string[], final?: string) {
  const out: string[] = [];
  const live = new LiveSpeech((t) => out.push(t));
  let text = "";
  for (const c of chunks) live.update((text += c));
  live.finish(final ?? text);
  return out;
}

describe("speechCut", () => {
  it("cuts after finished sentences and lines only", () => {
    expect(speechCut("Plants use light. Then", 0)).toBe(17);
    expect(speechCut("Pi is 3.14", 0)).toBe(-1);
    expect(speechCut("One line\nnext", 0)).toBe(9);
    expect(speechCut("Done.", 0)).toBe(-1);
  });

  it("waits for a code fence to close", () => {
    expect(speechCut("Look.\n```\nx = 1.\n", 0)).toBe(6);
    expect(speechCut("```\nx = 1.\n", 0)).toBe(-1);
  });
});

describe("LiveSpeech", () => {
  it("speaks each sentence once as it finishes", () => {
    const out = feed(["Chloroplasts cap", "ture light. Why", " do you think? ", "Tell me."]);
    expect(out).toEqual(["Chloroplasts capture light.", "Why do you think?", "Tell me."]);
  });

  it("skips markers, citations and code", () => {
    const out = feed(
      ["Light drives it [1]. ", "Here:\n```\nf(x)\n```\n", "That's all.\n{{follow", "up: Why green?}}\n{{remember: likes plants}}"],
      "Light drives it [1]. Here:\n```\nf(x)\n```\nThat's all.",
    );
    const said = out.join(" ");
    expect(said).toContain("Light drives it.");
    expect(said).toContain("That's all.");
    expect(said).not.toMatch(/[[\]{}`]|f\(x\)|Why green|likes plants/);
  });

  it("speaks the rest when the reply ends mid-sentence", () => {
    expect(feed(["First. Second without end"])).toEqual(["First.", "Second without end."]);
  });
});
