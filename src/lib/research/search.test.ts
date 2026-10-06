import { describe, expect, it } from "vitest";
import { normalizeForDedupe, parseArxiv, parseDuckDuckGo } from "./search";
import { extractJson } from "../chat/json";

describe("research parsing", () => {
  it("parses DuckDuckGo HTML results and unwraps redirect links", () => {
    const html = `<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FPhotosynthesis&amp;rut=x">Photosynthesis - <b>Wikipedia</b></a>
      <a class="result__snippet" href="x">Photosynthesis is a <b>process</b>&#x27;s</a></div>`;
    expect(parseDuckDuckGo(html)).toEqual([
      { title: "Photosynthesis - Wikipedia", url: "https://en.wikipedia.org/wiki/Photosynthesis", snippet: "Photosynthesis is a process's", engine: "duckduckgo" },
    ]);
  });

  it("parses arXiv atom entries", () => {
    const xml = `<feed><entry><id>http://arxiv.org/abs/1234.5678v1</id><title>A  Paper</title><summary> About things. </summary></entry></feed>`;
    expect(parseArxiv(xml)).toEqual([{ title: "A Paper", url: "https://arxiv.org/abs/1234.5678v1", snippet: "About things.", engine: "arxiv" }]);
  });

  it("dedupes URLs ignoring www, tracking params and trailing slashes", () => {
    expect(normalizeForDedupe("https://www.Example.com/a/?utm_source=x#top")).toBe(normalizeForDedupe("https://example.com/a"));
  });

  it("extracts JSON from chatty model replies", () => {
    expect(extractJson<{ q: string[] }>('<think>hmm</think>Sure!\n```json\n{"q": ["a", "b]"]}\n```')).toEqual({ q: ["a", "b]"] });
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson<number[]>("[1, 2]")).toEqual([1, 2]);
  });
});
