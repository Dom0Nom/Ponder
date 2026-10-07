import { describe, expect, it } from "vitest";
import { dueLabel, relativeShort } from "./utils";

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
