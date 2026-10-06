import { describe, expect, it } from "vitest";
import { checkPrompt, parseCheck } from "./selfCheck";

describe("self-check", () => {
  it("builds a prompt with numbered full passages and no markers", () => {
    const p = checkPrompt("Fact [1]. {{general}}Extra{{/general}}", [
      { n: 1, chunkId: 1, sourceId: "s", sourceTitle: "T", start: 0, end: 5, page: null, snippet: "short", text: "full passage text" },
    ]);
    expect(p).toContain("[1] full passage text");
    expect(p).not.toContain("{{general}}");
  });

  it("parses verdicts defensively", () => {
    const items = parseCheck(
      'Here you go: [{"claim":"A","verdict":"supported","passages":[1]},{"claim":"B","verdict":"wild","passages":[9]},{"claim":"C","verdict":"supported","passages":[]},{"claim":""}]',
      2,
    );
    expect(items).toEqual([
      { claim: "A", verdict: "supported", passages: [1], note: undefined },
      { claim: "B", verdict: "unsupported", passages: [], note: undefined },
      { claim: "C", verdict: "unsupported", passages: [], note: undefined },
    ]);
    expect(() => parseCheck("no json", 1)).toThrow();
  });
});
