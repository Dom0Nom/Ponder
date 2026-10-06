import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { formatInterval, previewIntervals, schedule, toFsrs } from "./scheduler";
import { addGap, clozeBack, clozeFront, clozeNumbers } from "./cloze";

const now = new Date("2026-10-06T10:00:00Z");

describe("fsrs scheduling", () => {
  it("schedules a new card and round-trips the stored state", () => {
    const fresh = { fsrs: null, due: now.getTime() };
    const good = schedule(fresh, Rating.Good, now);
    expect(good.due).toBeGreaterThan(now.getTime());
    const again = schedule(fresh, Rating.Again, now);
    expect(again.due).toBeLessThan(good.due);
    const restored = toFsrs({ fsrs: good.fsrs, due: good.due });
    expect(restored.due.getTime()).toBe(good.due);
    expect(restored.stability).toBeCloseTo(good.fsrs.stability as number);
  });

  it("grows intervals with successful reviews and shrinks them on a lapse", () => {
    let card = { fsrs: null as Record<string, unknown> | null, due: now.getTime() };
    let t = now;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = schedule(card, Rating.Good, t);
      intervals.push(r.due - t.getTime());
      card = { fsrs: r.fsrs, due: r.due };
      t = new Date(r.due);
    }
    expect(intervals[4]).toBeGreaterThan(intervals[2]);
    const lapse = schedule(card, Rating.Again, t);
    expect(lapse.due - t.getTime()).toBeLessThan(intervals[4]);
    expect((lapse.fsrs.lapses as number) ?? 0).toBe(1);
  });

  it("previews increasing intervals per button", () => {
    const p = previewIntervals({ fsrs: null, due: now.getTime() }, now);
    expect(Object.keys(p)).toHaveLength(4);
    expect(formatInterval(10 * 60_000)).toBe("10m");
    expect(formatInterval(3 * 86_400_000)).toBe("3d");
    expect(formatInterval(90 * 86_400_000)).toBe("3mo");
  });
});

describe("cloze", () => {
  const note = "The {{c1::Calvin cycle}} runs in the {{c2::stroma::part of chloroplast}} and needs {{c1::ATP}}.";
  it("finds gap numbers", () => expect(clozeNumbers(note)).toEqual([1, 2]));
  it("renders front and back per gap", () => {
    expect(clozeFront(note, 1)).toBe("The […] runs in the stroma and needs […].");
    expect(clozeFront(note, 2)).toBe("The Calvin cycle runs in the [part of chloroplast] and needs ATP.");
    expect(clozeBack(note, 2)).toBe("The Calvin cycle runs in the **stroma** and needs ATP.");
  });
  it("adds the next gap around a selection", () => {
    const t = "Water splits in the thylakoid.";
    const s = t.indexOf("thylakoid");
    expect(addGap(t, s, s + 9)).toBe("Water splits in the {{c1::thylakoid}}.");
    expect(addGap(note, 0, 3)).toContain("{{c3::The}}");
  });
});
