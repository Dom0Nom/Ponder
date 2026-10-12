import { describe, expect, it } from "vitest";
import { cellLang, clampOutput, formatValue, MAX_OUTPUT } from "./lang";

describe("code cells", () => {
  it("recognises runnable languages from the highlight class", () => {
    expect(cellLang("hljs language-python")).toBe("python");
    expect(cellLang("language-py")).toBe("python");
    expect(cellLang("language-JavaScript hljs")).toBe("js");
    expect(cellLang("language-js")).toBe("js");
    expect(cellLang("language-ts")).toBeNull();
    expect(cellLang("language-bash")).toBeNull();
    expect(cellLang(undefined)).toBeNull();
    expect(cellLang("hljs")).toBeNull();
  });

  it("formats values like a console", () => {
    expect(formatValue("hi")).toBe("hi");
    expect(formatValue(3)).toBe("3");
    expect(formatValue([1, 2, 3])).toBe("[1,2,3]");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue(new Map([["k", 1]]))).toBe('{"k":1}');
    expect(formatValue(10n)).toBe("10n");
    expect(formatValue(undefined)).toBe("undefined");
    expect(formatValue(function f() {})).toBe("[Function f]");
    expect(formatValue(new RangeError("bad"))).toBe("RangeError: bad");
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(formatValue(loop)).toBe('{"a":1,"self":"[Circular]"}');
  });

  it("clamps long output", () => {
    expect(clampOutput("x".repeat(MAX_OUTPUT + 10))).toHaveLength(MAX_OUTPUT + 2);
    expect(clampOutput("short")).toBe("short");
  });
});
