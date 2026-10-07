// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useFreshKeys } from "./useFreshKeys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useFreshKeys", () => {
  it("reports only keys that appear after the first load", async () => {
    let isFresh: (k: string) => boolean = () => false;
    const C = ({ keys }: { keys?: string[] }) => {
      isFresh = useFreshKeys(keys);
      return null;
    };
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(C, { keys: undefined })));
    await act(async () => root.render(createElement(C, { keys: ["a", "b"] })));
    expect(isFresh("a")).toBe(false);
    await act(async () => root.render(createElement(C, { keys: ["a", "b", "c"] })));
    expect(isFresh("c")).toBe(true);
    expect(isFresh("a")).toBe(false);
    await act(async () => root.render(createElement(C, { keys: ["a", "c"] })));
    expect(isFresh("c")).toBe(true);
  });
});
