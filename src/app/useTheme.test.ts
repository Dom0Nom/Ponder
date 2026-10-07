// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useUi } from "../stores/ui";
import { motionReduced, useReducedMotion, useVisualEffects } from "./useTheme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockMatchMedia = (matches: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches, addEventListener() {}, removeEventListener() {} }),
  });

async function read() {
  let out = { reduced: false, effects: false };
  const C = () => {
    out = { reduced: useReducedMotion(), effects: useVisualEffects() };
    return null;
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(C)));
  await act(async () => root.unmount());
  return out;
}

beforeEach(() => {
  mockMatchMedia(false);
  useUi.setState({ reduceMotion: false, visualEffects: true });
  delete document.documentElement.dataset.motion;
});
afterEach(() => useUi.setState({ reduceMotion: false, visualEffects: true }));

describe("reduced motion", () => {
  it("is true when the app setting is on and the OS flag is off", async () => {
    useUi.setState({ reduceMotion: true });
    expect((await read()).reduced).toBe(true);
  });
  it("is true when only the OS flag is on", async () => {
    mockMatchMedia(true);
    expect((await read()).reduced).toBe(true);
    expect(motionReduced()).toBe(true);
  });
  it("is false when neither is on", async () => {
    expect((await read()).reduced).toBe(false);
    expect(motionReduced()).toBe(false);
  });
  it("turns visual effects off", async () => {
    expect((await read()).effects).toBe(true);
    useUi.setState({ reduceMotion: true });
    expect((await read()).effects).toBe(false);
  });
});
