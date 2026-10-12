import { describe, expect, it } from "vitest";
import { rms, SILENCE, SilenceDetector } from "./silence";

const run = (levels: [number, number][], opt = SILENCE) => {
  const d = new SilenceDetector(opt, 0);
  let t = 0;
  for (const [level, ms] of levels) {
    for (let i = 0; i < ms / 100; i++) {
      t += 100;
      const v = d.push(level, t);
      if (v !== "continue") return { v, t, heard: d.heard };
    }
  }
  return { v: "continue", t, heard: d.heard };
};

describe("SilenceDetector", () => {
  it("stops 1.5 s after speech ends", () => {
    expect(run([[0.001, 500], [0.1, 1000], [0.001, 3000]])).toEqual({ v: "stop", t: 3100, heard: true });
  });

  it("keeps listening through short pauses between words", () => {
    expect(run([[0.1, 600], [0.001, 1000], [0.1, 600], [0.001, 1000]]).v).toBe("continue");
  });

  it("ignores a click shorter than the minimum speech time", () => {
    const r = run([[0.001, 300], [0.5, 100], [0.001, 3000]]);
    expect(r.heard).toBe(false);
    expect(r.v).toBe("continue");
  });

  it("goes idle when nothing is heard", () => {
    expect(run([[0.001, 30_000]]).v).toBe("idle");
  });

  it("never stops while the learner keeps talking", () => {
    expect(run([[0.1, 60_000]]).v).toBe("continue");
  });
});

describe("rms", () => {
  it("is the root mean square of the samples", () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });
});
