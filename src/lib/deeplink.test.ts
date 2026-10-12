import { describe, expect, it } from "vitest";
import { filePathFromUrl, parseDeepLink, resolveTarget } from "./deeplink";
import type { Space } from "./types";

const ok = (raw: string) => {
  const r = parseDeepLink(raw);
  if (!r.ok) throw new Error(`expected ok: ${raw} (${r.error})`);
  return r.link;
};

describe("parseDeepLink", () => {
  it("parses space links", () => {
    expect(ok("ponder://space/abc-123")).toEqual({ kind: "space", spaceId: "abc-123" });
    expect(ok("PONDER://Space/abc/")).toEqual({ kind: "space", spaceId: "abc" });
  });

  it("parses ask links with + and %20 spaces", () => {
    expect(ok("ponder://ask?q=why+is+the+sky+blue%3F&space=s1")).toEqual({ kind: "ask", question: "why is the sky blue?", spaceId: "s1" });
    expect(ok("ponder://ask?q=hello%20there")).toEqual({ kind: "ask", question: "hello there", spaceId: undefined });
  });

  it("parses import links", () => {
    expect(ok("ponder://import?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&space=s1")).toEqual({
      kind: "import",
      url: "https://example.com/a?b=1",
      spaceId: "s1",
    });
    expect(ok("ponder://import?url=file%3A%2F%2F%2FUsers%2Fme%2Fnotes.pdf")).toMatchObject({ kind: "import" });
  });

  it("rejects unknown hosts, wrong schemes and missing or bad values", () => {
    expect(parseDeepLink("ponder://delete?everything=1")).toEqual({ ok: false, error: "host", host: "delete" });
    expect(parseDeepLink("https://example.com")).toEqual({ ok: false, error: "scheme" });
    expect(parseDeepLink("ponder:space/abc")).toEqual({ ok: false, error: "scheme" });
    expect(parseDeepLink("ponder://space")).toEqual({ ok: false, error: "missing" });
    expect(parseDeepLink("ponder://space/a/b")).toEqual({ ok: false, error: "missing" });
    expect(parseDeepLink("ponder://ask?q=%20")).toEqual({ ok: false, error: "missing" });
    expect(parseDeepLink("ponder://import")).toEqual({ ok: false, error: "missing" });
    expect(parseDeepLink("ponder://import?url=javascript%3Aalert(1)")).toEqual({ ok: false, error: "invalid" });
    expect(parseDeepLink("ponder://ask?q=hi&space=../../x")).toEqual({ ok: false, error: "invalid" });
    expect(parseDeepLink("ponder://space/%E0%A4%A")).toEqual({ ok: false, error: "missing" });
  });

  it("caps very long questions", () => {
    const link = ok(`ponder://ask?q=${"a".repeat(9000)}`);
    expect(link.kind === "ask" && link.question.length).toBe(4000);
  });
});

describe("filePathFromUrl", () => {
  it("decodes local file urls", () => {
    expect(filePathFromUrl("file:///Users/me/my%20notes.pdf")).toBe("/Users/me/my notes.pdf");
    expect(filePathFromUrl("file:///C:/Users/me/a.pdf")).toBe("C:/Users/me/a.pdf");
    expect(filePathFromUrl("file://server/share/a.pdf")).toBeNull();
    expect(filePathFromUrl("https://example.com/a.pdf")).toBeNull();
  });
});

describe("resolveTarget", () => {
  const sp = (id: string, lastOpenedAt: number | null, updatedAt = 1) => ({ id, lastOpenedAt, updatedAt }) as Space;
  const spaces = [sp("a", 5), sp("b", 9), sp("c", null, 7)];

  it("uses the link's space, then the open one, then the most recent", () => {
    expect(resolveTarget({ kind: "ask", question: "q", spaceId: "c" }, spaces, "a")).toEqual({ ok: true, spaceId: "c" });
    expect(resolveTarget({ kind: "ask", question: "q" }, spaces, "a")).toEqual({ ok: true, spaceId: "a" });
    expect(resolveTarget({ kind: "ask", question: "q" }, spaces, null)).toEqual({ ok: true, spaceId: "b" });
  });

  it("fails for unknown spaces or no spaces", () => {
    expect(resolveTarget({ kind: "space", spaceId: "zzz" }, spaces, null)).toEqual({ ok: false, error: "unknownSpace" });
    expect(resolveTarget({ kind: "ask", question: "q" }, [], null)).toEqual({ ok: false, error: "noSpace" });
  });
});
