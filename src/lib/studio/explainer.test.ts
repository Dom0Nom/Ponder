import { describe, expect, it } from "vitest";
import { explainerDocument, parseExplainerReply, sanitizeExplainer, themeVars } from "./explainer";

const body =
  '<p>Move the slider and watch the rate change.</p><label>Light <input id="x" type="range"></label><output id="o"></output><script>const x = document.getElementById("x"); x.oninput = () => { document.getElementById("o").textContent = x.value; };</script>';

describe("explainer", () => {
  it("parses a titled html block and falls back to the first heading", () => {
    expect(parseExplainerReply(`TITLE: **Light and rate**\n\`\`\`html\n${body}\n\`\`\``)).toEqual({ title: "Light and rate", html: body.trim() });
    expect(parseExplainerReply(`\`\`\`html\n<h2>Slope</h2>${body}\n\`\`\``)).toEqual({ title: "Slope", html: body.trim() });
    expect(parseExplainerReply(`TITLE: Slope\n\`\`\`html\n<style>p{}</style>\n<h1>Slope</h1>${body}\n\`\`\``)?.html).toBe(`<style>p{}</style>\n${body.trim()}`);
    expect(parseExplainerReply("TITLE: Static\n```html\n<p>No controls here, just text.</p>\n```")).toBeNull();
    expect(parseExplainerReply("TITLE: x\n```html\n<script>1</script><button>b</button>\n```")).toBeNull();
  });

  it("removes tags that load other documents", () => {
    const html = sanitizeExplainer(
      '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://x"><link rel="stylesheet" href="https://x/a.css"><script src="https://cdn/x.js"></script></head><body><iframe src="https://x"></iframe><p>ok</p><script>go()</script></body></html>',
    );
    expect(html).toBe("<p>ok</p><script>go()</script>");
  });

  it("builds a document with a no-network CSP and the theme variables", () => {
    const doc = explainerDocument("<p>x</p>", themeVars((n) => (n === "--text" ? " #111 " : n === "--surface" ? "#fff" : "")), { title: "A <b>", resize: true });
    expect(doc).toContain(`content="default-src 'none'; script-src 'unsafe-inline'`);
    expect(doc).toContain("--fg:#111;");
    expect(doc).toContain("--bg:#fff;");
    expect(doc).not.toContain("--muted:;");
    expect(doc).toContain("<title>A b></title>");
    expect(doc).toContain("ponderExplainerHeight");
    expect(doc.indexOf("ponderExplainerError")).toBeLessThan(doc.indexOf("<p>x</p>"));
    expect(doc).not.toContain("<h1");
    expect(explainerDocument("<p>x</p>", {}, { title: "Slope" })).toContain(">Slope</h1><p>x</p>");
  });
});
