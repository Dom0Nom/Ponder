import { describe, expect, it } from "vitest";
import { feynmanPrompt, parseFeynman, wordCount } from "./feynman";

const fb = {
  clarity: 3,
  verdict: "Good start.",
  strengths: ["light"],
  gaps: ["Calvin cycle"],
  mistakes: [{ said: "in the mitochondria", correct: "in the chloroplasts" }],
  jargon: ["NADPH"],
  question: "Where does the sugar come from?",
};

describe("feynman", () => {
  it("builds a grounded prompt with a stable first line", () => {
    const p = feynmanPrompt({
      topic: " Photosynthesis ",
      explanation: "Plants make food from light.",
      passages: [{ source: "Notes", text: "Chlorophyll absorbs light." }],
    });
    expect(p.split("\n")[0]).toBe('A learner explains "Photosynthesis" in their own words, Feynman style: as if teaching someone new to it.');
    expect(p).toContain("[Notes] Chlorophyll absorbs light.");
    expect(p).not.toContain("EARLIER ROUNDS");
    expect(p).not.toContain("THEIR ANSWER");
  });

  it("includes earlier rounds and the answer to the last question", () => {
    const p = feynmanPrompt({
      topic: "x",
      explanation: "second try",
      passages: [],
      history: [{ explanation: "first try", feedback: fb }],
      answer: "From CO2.",
    });
    expect(p).toContain("textbook knowledge");
    expect(p).toContain("Explanation: first try");
    expect(p).toContain("Your question then: Where does the sugar come from?");
    expect(p).toContain("THEIR ANSWER TO YOUR LAST QUESTION\n\"\"\"\nFrom CO2.");
  });

  it("parses feedback, clamps the score and drops malformed entries", () => {
    expect(parseFeynman(JSON.stringify(fb))).toEqual(fb);
    const loose = parseFeynman('```json\n{"score": 9, "verdict": " ok ", "gaps": ["a", 3, ""], "mistakes": [{"said": "x"}, {"said": "y", "correct": "z"}]}\n```');
    expect(loose).toEqual({ clarity: 5, verdict: "ok", strengths: [], gaps: ["a"], mistakes: [{ said: "y", correct: "z" }], jargon: [], question: "" });
    expect(parseFeynman('{"verdict": "no score"}')).toBeNull();
    expect(parseFeynman("not json")).toBeNull();
  });

  it("counts words", () => {
    expect(wordCount("  a  b\nc ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});
