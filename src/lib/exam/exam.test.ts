import { describe, expect, it } from "vitest";
import type { TopicRef } from "../types";
import { GED, batches, distribute, scaledScore, sectionTopics } from "./formats";
import { capByQuota, examQuestionPrompt } from "./generate";
import { parseEssayGrade, parseEssayTask, repeatsIssue, tooShort } from "./essay";
import { clockText, examResult, weakTopics } from "./attempt";

const t = (id: string, group = "Math", title = id): TopicRef => ({ id, title, description: "", group }) as TopicRef;

describe("exam formats", () => {
  it("spreads questions evenly, earlier topics first", () => {
    expect(distribute([t("a"), t("b"), t("c")], 7).map((x) => x.n)).toEqual([3, 2, 2]);
    expect(distribute([t("a"), t("b"), t("c")], 2).map((x) => x.topic.id)).toEqual(["a", "b"]);
    expect(distribute([], 5)).toEqual([]);
  });

  it("splits quotas into batches of at most 10", () => {
    const b = batches(distribute([t("a"), t("b")], 25));
    expect(b.map((x) => x.reduce((n, y) => n + y.n, 0))).toEqual([10, 10, 5]);
    expect(b[0]).toEqual([{ topic: t("a"), n: 10 }]);
    expect(b[1].map((x) => [x.topic.id, x.n])).toEqual([["a", 3], ["b", 7]]);
  });

  it("maps raw share to the GED scale through the passing score", () => {
    expect(scaledScore(GED, 0)).toBe(100);
    expect(scaledScore(GED, GED.passMark)).toBe(145);
    expect(scaledScore(GED, 1)).toBe(200);
    expect(scaledScore(GED, 0.5)).toBeLessThan(145);
    expect(scaledScore(GED, 0.8)).toBeGreaterThan(145);
  });

  it("leaves the essay topic out of a section's questions", () => {
    const rla = GED.sections.find((s) => s.id === "rla")!;
    const topics = [t("r1", rla.group, "Main idea"), t("r2", rla.group, "Extended response essay"), t("m", "Math")];
    expect(sectionTopics(rla, topics).map((x) => x.id)).toEqual(["r1"]);
  });
});

describe("exam questions", () => {
  it("caps each topic at its quota and drops unknown topics", () => {
    const qs = [{ topicId: "a" }, { topicId: "a" }, { topicId: "b" }, { topicId: "x" }, { topicId: null }, { topicId: "a" }];
    expect(capByQuota(qs, new Map([["a", 2], ["b", 1]]))).toEqual([{ topicId: "a" }, { topicId: "a" }, { topicId: "b" }]);
  });

  it("states per-topic counts and the calculator rule", () => {
    const math = GED.sections[0];
    const p = examQuestionPrompt(GED, math, [{ topic: t("a"), n: 3 }, { topic: t("b"), n: 2 }]);
    expect(p.startsWith("Write multiple-choice questions for a timed GED Mathematical Reasoning")).toBe(true);
    expect(p).toContain("5 in total");
    expect(p).toContain('id "a"');
    expect(p).toContain("calculator is allowed");
  });
});

describe("essay", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("parses a task with two long passages", () => {
    const ok = JSON.stringify({ issue: "Uniforms", prompt: "Analyze both.", passages: [{ title: "For", text: words(200) }, { title: "Against", text: words(200) }] });
    expect(parseEssayTask(ok)?.passages).toHaveLength(2);
    const short = JSON.stringify({ issue: "U", prompt: "A", passages: [{ title: "For", text: words(200) }, { title: "Against", text: words(20) }] });
    expect(parseEssayTask(short)).toBeNull();
  });

  it("parses all three trait scores or nothing", () => {
    const g = parseEssayGrade(
      '```json\n{"traits":[{"trait":2,"score":1,"reason":"b"},{"trait":1,"score":2,"reason":"a"},{"trait":3,"score":"1","reason":"c"}],"summary":"s"}\n```',
    );
    expect(g?.traits.map((x) => x.score)).toEqual([2, 1, 1]);
    expect(g?.total).toBe(4);
    expect(parseEssayGrade('{"traits":[{"trait":1,"score":2},{"trait":2,"score":3},{"trait":3,"score":1}]}')).toBeNull();
    expect(parseEssayGrade('{"traits":[{"trait":1,"score":2}]}')).toBeNull();
  });

  it("spots a repeated essay issue", () => {
    expect(repeatsIssue("Daylight Saving Time", ["daylight saving time", "uniforms"])).toBe(true);
    expect(repeatsIssue("School uniforms in public schools", ["School uniforms"])).toBe(true);
    expect(repeatsIssue("Four-day school week", ["daylight saving time"])).toBe(false);
  });

  it("treats very short responses as unscorable", () => {
    expect(tooShort("I think uniforms are good.")).toBe(true);
    expect(tooShort(words(40))).toBe(false);
  });
});

describe("exam result", () => {
  const q = (topicId: string, answer = 0) => ({ topicId, question: "q", options: ["a", "b", "c", "d"], answer, explanation: "" });

  it("scores answers, groups by topic weakest first, and counts essay points double", () => {
    const data = {
      questions: [q("a"), q("a"), q("b"), q("b")],
      answers: [0, 0, 1, null],
      flags: [false, false, false, false],
      topics: [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }],
    };
    const r = examResult(GED, data);
    expect([r.correct, r.total]).toEqual([2, 4]);
    expect(r.byTopic.map((t) => [t.title, t.correct])).toEqual([["Beta", 0], ["Alpha", 2]]);
    expect(weakTopics(r).map((t) => t.topicId)).toEqual(["b"]);
    expect(r.passed).toBe(false);

    const withEssay = examResult(GED, { ...data, essay: { task: { issue: "", prompt: "", passages: [] }, text: "", grade: { traits: [], total: 5, summary: "" } } });
    expect(withEssay.essayPoints).toBe(10);
    expect(withEssay.share).toBeCloseTo(12 / 16);
    expect(withEssay.passed).toBe(true);
  });

  it("formats the countdown", () => {
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(3_725_000)).toBe("1:02:05");
    expect(clockText(400)).toBe("0:01");
  });
});
