import { describe, expect, it } from "vitest";
import { acquireFxSlot, acquireGlSlot, glSlotsInUse, MAX_GL_SLOTS, releaseFxSlot, releaseGlSlot } from "./glSlots";

describe("glSlots", () => {
  it("caps live contexts and frees slots on release", () => {
    const ids = Array.from({ length: MAX_GL_SLOTS + 1 }, () => Symbol("m"));
    const got = ids.map(acquireGlSlot);
    expect(got).toEqual([true, true, false]);
    expect(acquireGlSlot(ids[0])).toBe(true);
    expect(glSlotsInUse()).toBe(MAX_GL_SLOTS);
    releaseGlSlot(ids[0]);
    expect(acquireGlSlot(ids[2])).toBe(true);
    ids.forEach(releaseGlSlot);
    expect(glSlotsInUse()).toBe(0);
  });
});

describe("fx slots", () => {
  it("caps img-fx contexts separately from the mark slots", () => {
    const ids = [Symbol("a"), Symbol("b"), Symbol("c")];
    expect(ids.map(acquireFxSlot)).toEqual([true, true, false]);
    expect(glSlotsInUse()).toBe(0);
    releaseFxSlot(ids[0]);
    expect(acquireFxSlot(ids[2])).toBe(true);
    ids.forEach(releaseFxSlot);
  });
});
