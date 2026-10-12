import { describe, expect, it } from "vitest";
import { customCurriculumPrompt, parseCustomCurriculum } from "./customCurriculum";

describe("custom curriculum", () => {
  it("parses topics in order with linear prerequisites", () => {
    const r = parseCustomCurriculum('```json\n{"title":"Bio","topics":[{"title":"Cells","description":"organelles","group":"Basics"},{"title":"DNA","group":"Genetics"},{"description":"no title"}]}\n```');
    expect(r.title).toBe("Bio");
    expect(r.topics.map((t) => t.id)).toEqual(["custom.1", "custom.2"]);
    expect(r.topics[1]).toMatchObject({ description: "DNA", prereqs: ["custom.1"] });
    expect(r.topics[0].prereqs).toBeUndefined();
  });

  it("rejects replies with fewer than two topics", () => {
    expect(() => parseCustomCurriculum('{"topics":[{"title":"Only"}]}')).toThrow();
    expect(() => parseCustomCurriculum("no json")).toThrow();
  });

  it("caps the syllabus length in the prompt", () => {
    expect(customCurriculumPrompt("x".repeat(20000)).length).toBeLessThan(12500);
  });
});
