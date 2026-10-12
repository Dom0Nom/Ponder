import { describe, expect, it } from "vitest";
import type { DatedPlanTask, Mistake } from "../types";
import { briefingFacts, briefingPrompt, parseBriefing, type BriefingInput } from "./briefing";

const task = (title: string, date: string, doneAt: number | null = null): DatedPlanTask => ({
  id: title,
  spaceId: "s1",
  spaceName: "Biology",
  spaceIcon: "leaf",
  date,
  ord: 0,
  kind: "review",
  topicId: null,
  title,
  minutes: 20,
  doneAt,
});

const mistake = (topic: string, createdAt: number, resolved = false): Mistake => ({
  id: topic,
  spaceId: "s1",
  origin: "quiz",
  question: `About ${topic}?`,
  given: null,
  correct: "x",
  explanation: null,
  topic,
  cardId: null,
  resolved,
  createdAt,
  errorType: null,
});

const input = (over: Partial<BriefingInput> = {}): BriefingInput => ({
  today: "2026-10-12",
  weekday: "Monday",
  tasks: [],
  due: [],
  mistakes: [],
  newSources: [],
  ...over,
});

describe("daily briefing", () => {
  it("is empty when nothing is going on", () => {
    expect(briefingFacts(input({ due: [{ spaceId: "s1", spaceName: "Biology", due: 0, new: 0, total: 4 }] }))).toEqual([]);
  });

  it("collects today's plan, overdue work, due cards, open mistakes and new sources", () => {
    const facts = briefingFacts(
      input({
        tasks: [task("Calvin cycle", "2026-10-12"), task("Light reactions", "2026-10-12", 1), task("Old", "2026-10-10"), task("Later", "2026-10-14")],
        due: [{ spaceId: "s1", spaceName: "Biology", due: 5, new: 2, total: 30 }],
        mistakes: [mistake("stroma", 2), mistake("ATP", 3), mistake("done", 4, true)],
        newSources: [{ space: "Biology", title: "Leaf notes" }],
      }),
    );
    expect(facts).toEqual([
      "Plan for Biology: Calvin cycle (review, 20 min).",
      "Already done today in Biology: 1 of 2 tasks.",
      "Unfinished tasks from earlier days: 1.",
      "Flashcards in Biology: 5 due for review, 2 new.",
      "Open mistakes to revisit: 2, most recently about ATP; stroma.",
      'New since yesterday: "Leaf notes" in Biology.',
    ]);
  });

  it("has a stable first line and parses the reply", () => {
    expect(briefingPrompt(input(), ["x"]).split("\n")[0]).toBe("Write a short spoken study briefing for Monday.");
    expect(parseBriefing('```json\n{"text": "Start with the Calvin cycle review."}\n```')).toBe("Start with the Calvin cycle review.");
    expect(parseBriefing('{"text": "Hi"}')).toBeNull();
  });
});
