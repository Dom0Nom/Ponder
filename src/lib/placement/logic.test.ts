import { describe, expect, it } from "vitest";
import { capPerTopic, coverageLevel, detectChapters, gradeQuiz, levelFor, parseQuiz, pickPlacementTopics, shuffleOptions } from "./logic";
import { CURRICULA } from "./curricula";

describe("placement logic", () => {
  it("maps coverage scores to levels", () => {
    expect(coverageLevel(undefined)).toBe("missing");
    expect(coverageLevel({ topicId: "a", similarity: 0.6, keywordHits: 0, best: null })).toBe("covered");
    expect(coverageLevel({ topicId: "a", similarity: 0.45, keywordHits: 2, best: null })).toBe("covered");
    expect(coverageLevel({ topicId: "a", similarity: 0.45, keywordHits: 0, best: null })).toBe("partial");
    expect(coverageLevel({ topicId: "a", similarity: 0.2, keywordHits: 0, best: null })).toBe("missing");
    expect(coverageLevel({ topicId: "a", similarity: null, keywordHits: 3, best: null })).toBe("covered");
  });

  it("parses quizzes defensively", () => {
    const qs = parseQuiz(
      'Sure: [{"topicId":"t1","question":"2+2?","options":["3","4","5","6"],"answer":1,"explanation":"Adds up."},' +
        '{"question":"bad","options":["x"],"answer":0},{"question":"dup","options":["a","a"],"answer":0},' +
        '{"topicId":"zz","question":"Q2","options":["a","b"],"answer":5}]',
      ["t1", "t2"],
    );
    expect(qs).toEqual([{ topicId: "t1", question: "2+2?", options: ["3", "4", "5", "6"], answer: 1, explanation: "Adds up." }]);
    expect(parseQuiz('{"questions":[{"question":"Q","options":["a","b"],"answer":0}]}', ["only"])[0].topicId).toBe("only");
    expect(() => parseQuiz("nothing", [])).toThrow();
  });

  it("shuffles options but keeps the right answer", () => {
    const q = { topicId: null, question: "?", options: ["right", "b", "c", "d"], answer: 0, explanation: "" };
    let seed = 0.7;
    const s = shuffleOptions(q, () => (seed = (seed * 9301 + 0.49297) % 1));
    expect(s.options[s.answer]).toBe("right");
    expect([...s.options].sort()).toEqual([...q.options].sort());
  });

  it("grades by topic", () => {
    const q = (topicId: string, answer: number) => ({ topicId, question: "?", options: ["a", "b"], answer, explanation: "" });
    const r = gradeQuiz([q("a", 0), q("a", 1), q("b", 0), q("c", 1)], [0, 0, 0, 1]);
    expect(r.score).toBe(0.75);
    expect(r.byTopic.find((t) => t.topicId === "a")?.level).toBe("ok");
    expect(r.byTopic.find((t) => t.topicId === "b")?.level).toBe("strong");
    expect(levelFor(0, 2)).toBe("weak");
    expect(levelFor(0, 0)).toBe("unknown");
  });

  it("spreads placement topics across groups", () => {
    const ged = CURRICULA.find((c) => c.id === "ged")!;
    const picked = pickPlacementTopics(ged.topics, 8);
    expect(picked.length).toBe(8);
    expect(new Set(picked.map((t) => t.group)).size).toBe(4);
    expect(new Set(picked).size).toBe(8);
  });

  it("curricula have unique ids and valid prerequisites", () => {
    for (const c of CURRICULA) {
      const ids = new Set(c.topics.map((t) => t.id));
      expect(ids.size).toBe(c.topics.length);
      for (const t of c.topics) for (const p of t.prereqs ?? []) expect(ids.has(p)).toBe(true);
    }
  });

  it("detects chapters from headings and Chapter lines", () => {
    const body = "x".repeat(500);
    const md = `# The Book\n\n## Chapter One\n${body}\n## Chapter Two\n${body}\n## Chapter Three\n${body}`;
    const ch = detectChapters(md);
    expect(ch.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two", "Chapter Three"]);
    expect(ch[0].start).toBe(0);
    expect(md.slice(ch[1].start, ch[1].start + 15)).toBe("## Chapter Two\n");
    expect(ch[ch.length - 1].end).toBe(md.length);
    const pdf = `Intro text\nCHAPTER 1 Cells\n${body}\nChapter 2: Energy\n${body}`;
    expect(detectChapters(pdf).map((c) => c.title)).toEqual(["CHAPTER 1 Cells", "Chapter 2: Energy"]);
    expect(detectChapters("no chapters here")).toEqual([]);
  });
});

describe("capPerTopic", () => {
  it("keeps the first n questions of each topic", () => {
    const qs = ["a", "a", "b", "a", "b", "b"].map((topicId, i) => ({ topicId, i }));
    expect(capPerTopic(qs, 2).map((q) => q.i)).toEqual([0, 1, 2, 4]);
  });
});
