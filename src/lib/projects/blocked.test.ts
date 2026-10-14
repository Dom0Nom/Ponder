import { describe, expect, it } from "vitest";
import type { Project, ProjectMilestone, TopicLevel, TopicRef } from "../types";
import { blockedTopics, progress, projectSuggestions } from "./blocked";

const topics: TopicRef[] = [
  { id: "a", title: "Ohm's law", description: "", group: "g" },
  { id: "b", title: "PWM", description: "", group: "g" },
];
const lvl = (topicId: string, level: TopicLevel["level"]): TopicLevel => ({ topicId, level, evidence: null, updatedAt: 0 }) as TopicLevel;
const ms = (id: string, topicIds: string[], doneAt: number | null = null): ProjectMilestone => ({ id, projectId: "p", title: id, topicIds, position: 1, doneAt });
const project = (milestones: ProjectMilestone[]): Project => ({ id: "p", spaceId: "s", title: "Robot", goal: "", createdAt: 0, updatedAt: 0, milestones, log: [] });

describe("project milestones", () => {
  it("blocks on topics that aren't strong, ignores unknown ids and done milestones", () => {
    const levels = [lvl("a", "strong"), lvl("b", "ok")];
    expect(blockedTopics(ms("m", ["a", "b", "zzz"]), levels, topics).map((t) => t.id)).toEqual(["b"]);
    expect(blockedTopics(ms("m", ["b"], 5), levels, topics)).toEqual([]);
    expect(blockedTopics(ms("m", ["a"]), levels, topics)).toEqual([]);
  });

  it("suggests the first blocked topic of the first blocked open milestone", () => {
    const levels = [lvl("a", "strong")];
    const p = project([ms("free", []), ms("done", ["b"], 1), ms("blocked", ["a", "b"])]);
    const [s] = projectSuggestions([p], levels, topics);
    expect(s).toMatchObject({ milestoneId: "blocked", topic: { id: "b" } });
    expect(projectSuggestions([project([ms("x", ["a"])])], levels, topics)).toEqual([]);
  });

  it("counts progress", () => {
    expect(progress(project([ms("a", [], 1), ms("b", [])]))).toEqual({ done: 1, total: 2 });
  });
});
