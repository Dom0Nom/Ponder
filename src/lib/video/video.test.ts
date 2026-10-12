import { describe, expect, it } from "vitest";
import { narration, pickMime, schedule, wrapLines } from "./video";

describe("video overview", () => {
  it("narrates the speaker notes, else the slide text", () => {
    expect(narration({ title: "T", bullets: ["a"], notes: " Say this. " })).toBe("Say this.");
    expect(narration({ title: "Light", bullets: ["Photons", " "], notes: "" })).toBe("Light. Photons");
  });

  it("schedules slides back to back with a gap, and gives silent slides a fixed time", () => {
    expect(schedule([2, 0, 1.5], 0.5)).toEqual([
      { start: 0, end: 2.5 },
      { start: 2.5, end: 7 },
      { start: 7, end: 9 },
    ]);
  });

  it("wraps text by measured width", () => {
    expect(wrapLines("aa bb cc dd", 5, (x) => x.length)).toEqual(["aa bb", "cc dd"]);
    expect(wrapLines("extraordinarily long", 5, (x) => x.length)).toEqual(["extraordinarily", "long"]);
    expect(wrapLines("  ", 5, (x) => x.length)).toEqual([]);
  });

  it("prefers MP4 and falls back to WebM", () => {
    expect(pickMime((m) => m === "video/mp4")).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(pickMime((m) => m.startsWith("video/webm"))).toEqual({ mime: "video/webm;codecs=vp9,opus", ext: "webm" });
    expect(pickMime(() => false)).toBeNull();
  });
});
