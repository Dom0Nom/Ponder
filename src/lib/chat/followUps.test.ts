import { describe, expect, it } from "vitest";
import { extractFollowUps, hideFollowUpMarkers } from "./followUps";

describe("follow-up markers", () => {
  it("extracts follow-ups and removes markers", () => {
    const r = extractFollowUps("Answer.\n\n{{followup: Why does that work?}}\n{{followup: Can you show an example?}}");
    expect(r.clean).toBe("Answer.");
    expect(r.followUps).toEqual(["Why does that work?", "Can you show an example?"]);
  });

  it("keeps at most three, drops duplicates and overlong ones", () => {
    const long = "x".repeat(91);
    const r = extractFollowUps(`A {{followup: One?}} {{followup: One?}} {{followup: ${long}}} {{followup: Two?}} {{followup: Three?}} {{followup: Four?}}`);
    expect(r.followUps).toEqual(["One?", "Two?", "Three?"]);
  });

  it("hides complete and half-streamed markers", () => {
    expect(hideFollowUpMarkers("Answer.\n\n{{follow")).toBe("Answer.");
    expect(hideFollowUpMarkers("Answer.\n\n{{followup: Why does")).toBe("Answer.");
    expect(hideFollowUpMarkers("Answer.\n\n{{")).toBe("Answer.");
    expect(hideFollowUpMarkers("Answer. {{followup: x?}} more")).toBe("Answer.  more");
    expect(hideFollowUpMarkers("a {b} c")).toBe("a {b} c");
  });
});
