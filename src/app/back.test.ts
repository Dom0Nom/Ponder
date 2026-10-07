import { describe, expect, it } from "vitest";
import { backTarget } from "./back";

describe("backTarget", () => {
  it("goes from a practice topic to the practice hub", () => {
    expect(backTarget({ name: "practice", spaceId: "s1", topicKey: "t" }, null)).toEqual({ name: "practice", spaceId: "s1" });
  });
  it("returns to where practice or review was opened from", () => {
    expect(backTarget({ name: "practice", spaceId: "s1" }, { name: "space", spaceId: "s1" })).toEqual({ name: "space", spaceId: "s1" });
    expect(backTarget({ name: "review" }, { name: "space", spaceId: "s2" })).toEqual({ name: "space", spaceId: "s2" });
  });
  it("falls back to the space, then home", () => {
    expect(backTarget({ name: "practice", spaceId: "s1" }, null)).toEqual({ name: "space", spaceId: "s1" });
    expect(backTarget({ name: "review", spaceId: "s1" }, null)).toEqual({ name: "space", spaceId: "s1" });
    expect(backTarget({ name: "review" }, null)).toEqual({ name: "home" });
  });
  it("has no target elsewhere", () => {
    expect(backTarget({ name: "home" }, null)).toBeNull();
  });
});
