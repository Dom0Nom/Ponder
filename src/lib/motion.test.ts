import { describe, expect, it } from "vitest";
import { effectsActive, markShaderEnabled } from "./motion";

describe("effectsActive", () => {
  it("is on only when the setting is on and motion is not reduced", () => {
    expect(effectsActive(true, false)).toBe(true);
    expect(effectsActive(true, true)).toBe(false);
    expect(effectsActive(false, false)).toBe(false);
    expect(effectsActive(false, true)).toBe(false);
  });
});

describe("markShaderEnabled", () => {
  it("falls back to the static mark unless effects, motion and WebGL2 all allow it", () => {
    expect(markShaderEnabled(true, false, true)).toBe(true);
    expect(markShaderEnabled(true, true, true)).toBe(false);
    expect(markShaderEnabled(false, false, true)).toBe(false);
    expect(markShaderEnabled(true, false, false)).toBe(false);
  });
});
