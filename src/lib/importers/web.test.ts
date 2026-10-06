// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractReadable, normalizeUrl } from "./web";

describe("web import", () => {
  it("normalizes addresses", () => {
    expect(normalizeUrl("en.wikipedia.org/wiki/Cell")).toBe("https://en.wikipedia.org/wiki/Cell");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("notaurl")).toBeNull();
  });

  it("keeps article text, drops images and link targets", () => {
    const para = "The mitochondrion is an organelle found in the cells of most eukaryotes. ".repeat(6);
    const html = `<html><head><title>Mito</title></head><body><nav>Menu</nav><article><h1>Mitochondrion</h1>
      <p>${para}<a href="/wiki/ATP">ATP</a> is made here.</p><img src="x.png" alt="diagram"><p>${para}</p></article></body></html>`;
    const page = extractReadable(html, "https://example.org/mito")!;
    expect(page.markdown).toContain("ATP is made here.");
    expect(page.markdown).not.toContain("](");
    expect(page.markdown).not.toContain("x.png");
    expect(page.markdown).not.toContain("Menu");
  });
});
