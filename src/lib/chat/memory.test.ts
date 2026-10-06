import { describe, expect, it } from "vitest";
import { extractMemories, hideMemoryMarkers } from "./memory";

describe("learner memory markers", () => {
  it("extracts facts and removes markers", () => {
    const r = extractMemories("Sure, here's the idea.\n\n{{remember: Is preparing for the GED math test in March.}}");
    expect(r.clean).toBe("Sure, here's the idea.");
    expect(r.memories).toEqual(["Is preparing for the GED math test in March"]);
  });

  it("caps and dedupes", () => {
    const r = extractMemories("{{remember: A fact}} {{remember: A fact}} {{remember: B fact}} {{remember: C fact}}");
    expect(r.memories).toEqual(["A fact", "B fact"]);
  });

  it("hides partial markers while streaming", () => {
    expect(hideMemoryMarkers("Answer.\n\n{{remem")).toBe("Answer.");
    expect(hideMemoryMarkers("Answer.\n\n{{remember: likes mine")).toBe("Answer.");
    expect(hideMemoryMarkers("Answer. {{remember: x}} more")).toBe("Answer.  more");
    expect(hideMemoryMarkers("a {b} c")).toBe("a {b} c");
  });
});
