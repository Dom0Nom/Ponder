// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MarkShaderState } from "./markPresets";
import { IDLE_REST_MS, useSteppedFrames } from "./steppedFrames";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let frames = 0;
let root: Root;
let focused = true;

function Mark({ state }: { state: MarkShaderState }) {
  const ref = useSteppedFrames(state, 1);
  (ref as { current: unknown }).current = { paperShaderMount: { setFrame: () => frames++ } };
  return null;
}

async function mount(state: MarkShaderState) {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Mark, { state })));
}

const framesDuring = (ms: number) => {
  const before = frames;
  vi.advanceTimersByTime(ms);
  return frames - before;
};

beforeEach(() => {
  vi.useFakeTimers();
  frames = 0;
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSteppedFrames", () => {
  it("rests an idle mark after a while without input and wakes on input", async () => {
    await mount("idle");
    expect(framesDuring(1000)).toBe(12);
    vi.advanceTimersByTime(IDLE_REST_MS);
    expect(framesDuring(5000)).toBe(0);
    window.dispatchEvent(new Event("pointermove"));
    expect(framesDuring(1000)).toBe(12);
  });

  it("keeps a generating mark moving without input", async () => {
    await mount("generating");
    vi.advanceTimersByTime(IDLE_REST_MS * 2);
    expect(framesDuring(1000)).toBe(30);
  });

  it("stops while the window is unfocused", async () => {
    await mount("generating");
    focused = false;
    window.dispatchEvent(new Event("blur"));
    expect(framesDuring(2000)).toBe(0);
    window.dispatchEvent(new Event("pointermove"));
    expect(framesDuring(1000)).toBe(0);
    focused = true;
    window.dispatchEvent(new Event("focus"));
    expect(framesDuring(1000)).toBe(30);
  });
});
