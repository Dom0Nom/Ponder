import { describe, expect, it } from "vitest";
import { MAX_STEPS, microStepPrompt, parseMicroSteps } from "./microSteps";

describe("parseMicroSteps", () => {
  it("clamps minutes, drops empties, strips list markers", () => {
    const out = parseMicroSteps(
      JSON.stringify([
        { text: "1. Open the PDF", minutes: 1 },
        { text: "  ", minutes: 3 },
        { text: "Read page 41", minutes: 30 },
        { text: "- Write two lines", minutes: "4" },
        { text: "No minutes" },
        { minutes: 3 },
        42,
        "Plain string",
      ]),
    );
    expect(out).toEqual([
      { text: "Open the PDF", minutes: 2 },
      { text: "Read page 41", minutes: 5 },
      { text: "Write two lines", minutes: 4 },
      { text: "No minutes", minutes: 3 },
      { text: "Plain string", minutes: 3 },
    ]);
  });

  it("accepts a {steps} wrapper and fenced output", () => {
    const out = parseMicroSteps('```json\n{"steps":[{"step":"Open the book","minutes":2.4}]}\n```');
    expect(out).toEqual([{ text: "Open the book", minutes: 2 }]);
  });

  it("caps the count and survives garbage", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `Step ${i}`, minutes: 3 }));
    expect(parseMicroSteps(JSON.stringify(many))).toHaveLength(MAX_STEPS);
    expect(parseMicroSteps("sorry, I can't")).toEqual([]);
    expect(parseMicroSteps('{"foo": 1}')).toEqual([]);
  });
});

describe("microStepPrompt", () => {
  it("includes goal and context", () => {
    const p = microStepPrompt({ goal: " Chapter 3 ", spaceName: "Bio", sourceTitles: ["Campbell ch3.pdf"] });
    expect(p).toContain("Goal: Chapter 3");
    expect(p).toContain("Bio");
    expect(p).toContain("Campbell ch3.pdf");
  });
});
