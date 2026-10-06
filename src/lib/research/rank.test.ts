import { describe, expect, it } from "vitest";
import { applyRatings, filterAndSort, MIN_RELEVANCE } from "./deepResearch";

const page = (n: number) => ({ title: `P${n}`, url: `https://x.org/${n}`, snippet: "", engine: "duckduckgo" as const, markdown: "text" });

describe("research ranking", () => {
  it("caps relevance when the page doesn't answer the question", () => {
    const [a] = applyRatings([page(0)], [{ i: 0, answers: false, relevance: 85, credibility: 95 }]);
    expect(a.relevance).toBeLessThan(MIN_RELEVANCE);
  });

  it("treats an unrated page as irrelevant", () => {
    const [a] = applyRatings([page(0)], []);
    expect(a.relevance).toBe(0);
  });

  it("drops results under the threshold and ranks relevance above credibility", () => {
    const found = applyRatings(
      [page(0), page(1), page(2)],
      [
        { i: 0, answers: true, relevance: 90, credibility: 60 },
        { i: 1, answers: true, relevance: 60, credibility: 100 },
        { i: 2, answers: true, relevance: 30, credibility: 100 },
      ],
    );
    expect(filterAndSort(found).map((f) => f.title)).toEqual(["P0", "P1"]);
  });
});
