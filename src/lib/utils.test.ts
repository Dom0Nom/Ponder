import { describe, expect, it } from "vitest";
import { dayGroup, formatDuration } from "./utils";

const at = (d: string) => new Date(d).getTime();

describe("dayGroup", () => {
  const now = at("2026-10-07T00:30:00");
  it("buckets by local calendar day", () => {
    expect(dayGroup(at("2026-10-07T00:00:01"), now)).toBe("today");
    expect(dayGroup(at("2026-10-06T23:59:59"), now)).toBe("yesterday");
    expect(dayGroup(at("2026-10-01T12:00:00"), now)).toBe("week");
    expect(dayGroup(at("2026-09-30T12:00:00"), now)).toBe("month");
    expect(dayGroup(at("2026-09-29T12:00:00"), now)).toBe("month");
    expect(dayGroup(at("2026-09-08T12:00:00"), now)).toBe("month");
    expect(dayGroup(at("2026-09-07T12:00:00"), now)).toBe("older");
  });
  it("treats future timestamps as today", () => {
    expect(dayGroup(at("2026-10-09T12:00:00"), now)).toBe("today");
  });
});

describe("formatDuration", () => {
  it("drops the leading zero on minutes", () => {
    expect(formatDuration(57_000)).toBe("0:57");
    expect(formatDuration(18 * 60_000 + 42_000)).toBe("18:42");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
});
