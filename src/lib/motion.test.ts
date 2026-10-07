import { describe, expect, it } from "vitest";
import { effectsActive } from "./motion";

describe("effectsActive", () => {
  it("is on only when the setting is on and motion is not reduced", () => {
    expect(effectsActive(true, false)).toBe(true);
    expect(effectsActive(true, true)).toBe(false);
    expect(effectsActive(false, false)).toBe(false);
    expect(effectsActive(false, true)).toBe(false);
  });
});
