import { describe, expect, it } from "vitest";
import { AMBIENT_SOUNDS, makeLoop, readAmbient } from "./ambient";

const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};

describe("ambient sounds", () => {
  it("reads prefs defensively", () => {
    expect(readAmbient(undefined)).toEqual({ sound: "off", volume: 0.4 });
    expect(readAmbient({ sound: "rain", volume: 2 })).toEqual({ sound: "rain", volume: 1 });
    expect(readAmbient({ sound: "jazz", volume: "x" })).toEqual({ sound: "off", volume: 0.4 });
  });

  it.each(AMBIENT_SOUNDS)("%s loops seamlessly, is audible and never clips", (kind) => {
    const rate = 8000;
    const [l, r] = makeLoop(kind, rate);
    expect(l.length).toBe(r.length);
    expect(l.length % rate).toBe(0);
    for (const ch of [l, r]) {
      let peak = 0;
      for (const v of ch) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeLessThanOrEqual(0.8001);
      expect(rms(ch)).toBeGreaterThan(0.02);
      expect(Number.isFinite(rms(ch))).toBe(true);
      // the jump from the last sample back to the first is no bigger than a typical step
      const steps = Array.from({ length: ch.length - 1 }, (_, i) => Math.abs(ch[i + 1] - ch[i])).sort((a, b) => a - b);
      expect(Math.abs(ch[0] - ch[ch.length - 1])).toBeLessThanOrEqual(steps[Math.floor(steps.length * 0.999)]);
    }
    expect(l).not.toEqual(r);
  });

  it("is deterministic", () => {
    expect(makeLoop("pink", 4000)[0]).toEqual(makeLoop("pink", 4000)[0]);
  });
});
