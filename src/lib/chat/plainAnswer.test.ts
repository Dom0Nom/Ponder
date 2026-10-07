import { describe, expect, it } from "vitest";
import { plainAnswer } from "./plainAnswer";

describe("plainAnswer", () => {
  it("strips general markers and citation brackets", () => {
    expect(plainAnswer("Use {{general}}x{{/general}} first [1][2]. Then y [~3, 4].")).toBe("Use x first. Then y.");
  });
  it("keeps other brackets", () => {
    expect(plainAnswer("an array [a, b] and [x]")).toBe("an array [a, b] and [x]");
  });
});
