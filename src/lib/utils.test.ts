import { describe, expect, it } from "vitest";
import { dayLabel, dueLabel, formatShortMinutes, relativeShort, shortRelative } from "./utils";

const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe("relativeShort", () => {
  it("buckets by size", () => {
    expect(relativeShort(NOW - 59_000, NOW)).toBe("just now");
    expect(relativeShort(NOW - 59 * MIN, NOW)).toBe("59m ago");
    expect(relativeShort(NOW - 23 * 60 * MIN, NOW)).toBe("23h ago");
    expect(relativeShort(NOW - 6 * DAY, NOW)).toBe("6d ago");
    expect(relativeShort(NOW - 14 * DAY, NOW)).toBe("2w ago");
    expect(relativeShort(NOW - 59 * DAY, NOW)).toBe("8w ago");
    expect(relativeShort(NOW - 60 * DAY, NOW)).toBe(new Date(NOW - 60 * DAY).toLocaleDateString());
  });
});

describe("dueLabel", () => {
  const now = new Date(NOW);
  it("labels by calendar day", () => {
    expect(dueLabel(NOW, now)).toBe("Due today");
    expect(dueLabel(NOW - 3 * DAY, now)).toBe("Due today");
    expect(dueLabel(NOW + DAY, now)).toBe("Due tomorrow");
    expect(dueLabel(NOW + 3 * DAY, now)).toBe("Due in 3 days");
  });
});

const at = (d: string) => new Date(d).getTime();

describe("short labels", () => {
  const now = at("2026-10-07T15:00:00");
  it("formatShortMinutes", () => {
    expect(formatShortMinutes(50 * 60_000)).toBe("50m");
    expect(formatShortMinutes(80 * 60_000)).toBe("1h 20m");
    expect(formatShortMinutes(120 * 60_000)).toBe("2h");
  });
  it("dayLabel", () => {
    expect(dayLabel(at("2026-10-07T09:00:00"), now)).toBe("Today");
    expect(dayLabel(at("2026-10-06T09:00:00"), now)).toBe("Yesterday");
    expect(dayLabel(at("2026-10-04T09:00:00"), now)).toBe("Sun");
    expect(dayLabel(at("2026-09-20T09:00:00"), now)).toBe("Sep 20");
  });
  it("shortRelative", () => {
    expect(shortRelative(now - 10_000, now)).toBe("just now");
    expect(shortRelative(now - 5 * 60_000, now)).toBe("5m ago");
    expect(shortRelative(at("2026-10-07T12:00:00"), now)).toBe("3h ago");
    expect(shortRelative(at("2026-10-06T12:00:00"), now)).toBe("Yesterday");
    expect(shortRelative(at("2026-10-04T15:00:00"), now)).toBe("3d ago");
    expect(shortRelative(at("2026-09-01T15:00:00"), now)).toBe("Sep 1");
  });
});
