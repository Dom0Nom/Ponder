import { describe, expect, it } from "vitest";
import { s } from "../strings";
import { ThinkingTimer, thoughtLabel, thoughtSeconds } from "./thinking";

function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("ThinkingTimer", () => {
  it("measures first reasoning token to first answer token", () => {
    const c = clock();
    const timer = new ThinkingTimer(c.now);
    timer.reasoning();
    c.advance(4200);
    timer.reasoning();
    c.advance(300);
    timer.text();
    c.advance(9000);
    timer.finish();
    expect(timer.thinkingMs).toBe(4500);
  });

  it("is zero when the model never reasoned", () => {
    const c = clock();
    const timer = new ThinkingTimer(c.now);
    timer.text();
    c.advance(500);
    timer.finish();
    expect(timer.thinkingMs).toBe(0);
  });

  it("closes at the end of the stream when no answer text came", () => {
    const c = clock();
    const timer = new ThinkingTimer(c.now);
    timer.reasoning();
    c.advance(2000);
    timer.finish();
    expect(timer.thinkingMs).toBe(2000);
  });
});

describe("thought label", () => {
  it("rounds to whole seconds, at least one", () => {
    expect(thoughtSeconds(100)).toBe(1);
    expect(thoughtSeconds(4500)).toBe(5);
  });
  it("uses the decided copy", () => {
    expect(thoughtLabel(1)).toBe("Thought for 1 second");
    expect(thoughtLabel(12)).toBe("Thought for 12 seconds");
    expect(thoughtLabel(120)).toBe("Thought for 2 min");
    expect(s.chat.thoughts).toBe("Reasoning");
  });
});
