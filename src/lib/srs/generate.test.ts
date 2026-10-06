import { describe, expect, it } from "vitest";
import { locateQuote, parseCards, type Passage } from "./generate";

const passages: Passage[] = [
  { sourceId: "s1", sourceTitle: "Bio", text: "The Calvin cycle takes place in the stroma. It uses ATP and NADPH.", start: 100, end: 166 },
  { sourceId: "s2", sourceTitle: "Bio 2", text: "Glycolysis happens in the cytoplasm.", start: 0, end: 36 },
];

describe("card generation parsing", () => {
  it("keeps valid basic and cloze cards and links them to the quoted words", () => {
    const cards = parseCards(
      `Here: [{"type":"basic","front":"Where is the Calvin cycle?","back":"Stroma","passage":1,"quote":"takes place in the stroma"},
       {"type":"cloze","text":"Glycolysis happens in the {{c1::cytoplasm}}.","passage":2,"quote":"Glycolysis happens in the cytoplasm"},
       {"type":"cloze","text":"no gap here","passage":1},
       {"type":"basic","front":"Where is the Calvin cycle?","back":"dup","passage":1},
       {"type":"basic","front":"No back"}]`,
      passages,
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ kind: "basic", sourceId: "s1", chunkStart: 100 + passages[0].text.indexOf("takes place"), origin: "generated" });
    expect(cards[1]).toMatchObject({ kind: "cloze", back: "", sourceId: "s2", chunkStart: 0 });
  });

  it("falls back to the whole passage when the quote isn't found", () => {
    expect(locateQuote(passages[0], "something else entirely")).toEqual({ start: 100, end: 166 });
  });

  it("rejects replies without cards", () => {
    expect(() => parseCards("sorry", passages)).toThrow();
    expect(() => parseCards("[]", passages)).toThrow();
  });
});
