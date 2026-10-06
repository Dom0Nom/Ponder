// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractReadable, normalizeUrl, trimBoilerplate } from "./web";

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

describe("boilerplate trimming", () => {
  const para = "Photosynthesis converts light energy into chemical energy stored in sugars. ".repeat(5);

  it("drops reference and link sections but keeps later content sections", () => {
    const md = `# Photosynthesis\n\n${para}\\[1\\]\n\n## Light reactions\n\nText.\\[citation needed\\]\n\n## See also\n\n- Calvin cycle\n\n## References\n\n1. Smith 2001\n\n### Sources\n\n- Book\n\n## External links\n\n- site`;
    const out = trimBoilerplate(md);
    expect(out).toContain("## Light reactions");
    expect(out).toContain("Text.");
    expect(out).not.toMatch(/See also|References|Smith 2001|Sources|External links|citation needed|\\\[1/);
  });

  it("keeps code with brackets intact", () => {
    expect(trimBoilerplate("```js\nconst a = b[0];\n```")).toContain("b[0]");
  });

  it("removes Wikipedia navboxes, reference lists and edit links before extraction", () => {
    const html = `<html><head><title>P</title></head><body><div id="content"><h1>Photosynthesis</h1>
      <p>${para}<sup class="reference"><a href="#c1">[1]</a></sup></p><p>${para}</p>
      <h2>Mechanism<span class="mw-editsection">[edit]</span></h2><p>${para}</p>
      <div class="navbox">Plant physiology navbox Botany Ecology</div>
      <h2>References</h2><div class="reflist"><ol class="references"><li>Smith, J. (2001). Plants.</li></ol></div>
    </div></body></html>`;
    const page = extractReadable(html, "https://en.wikipedia.org/wiki/Photosynthesis")!;
    expect(page.markdown).toContain("Mechanism");
    expect(page.markdown).not.toMatch(/navbox|Smith, J\.|\[1\]|\[edit\]|References/);
  });
});
