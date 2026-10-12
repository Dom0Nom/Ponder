import { describe, expect, it } from "vitest";
import { imageFromSnip, parseSnipSource, snipPreviewUrl } from "./snip";

describe("parseSnipSource", () => {
  it("uses the first line as the title and keeps the whole text", () => {
    const r = parseSnipSource("Plant cell diagram\n\nThe chloroplast is labelled.");
    expect(r.title).toBe("Plant cell diagram");
    expect(r.body).toBe("Plant cell diagram\n\nThe chloroplast is labelled.");
  });
  it("strips Markdown heading marks and quotes from the title", () => {
    expect(parseSnipSource('## "Krebs cycle"\nsteps').title).toBe("Krebs cycle");
  });
  it("falls back to a dated title when the first line is too long", () => {
    const r = parseSnipSource(`${"x".repeat(120)}\nmore`, new Date(2026, 0, 5));
    expect(r.title).toMatch(/^Screenshot · /);
  });
  it("skips leading blank lines", () => {
    expect(parseSnipSource("\n\n  Title \nbody").title).toBe("Title");
  });
});

describe("snip image helpers", () => {
  const snip = { mediaType: "image/png", data: "AAAA" };
  it("builds model input and a preview url", () => {
    expect(imageFromSnip(snip)).toEqual({ data: "AAAA", mediaType: "image/png" });
    expect(snipPreviewUrl(snip)).toBe("data:image/png;base64,AAAA");
  });
});
