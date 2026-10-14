import type { Project, ProjectMilestone, TopicLevel, TopicRef } from "../types";

export const isMastered = (topicId: string, levels: TopicLevel[]) => levels.find((l) => l.topicId === topicId)?.level === "strong";

/** Topics a milestone needs that aren't mastered yet. Unknown topic ids are ignored. */
export function blockedTopics(m: ProjectMilestone, levels: TopicLevel[], topics: TopicRef[]): TopicRef[] {
  if (m.doneAt) return [];
  return m.topicIds.filter((id) => !isMastered(id, levels)).flatMap((id) => topics.find((t) => t.id === id) ?? []);
}

export interface ProjectSuggestion {
  projectId: string;
  projectTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  topic: TopicRef;
}

/** One "study X" suggestion per project: its first open milestone that is blocked, on that milestone's first unmastered topic. */
export function projectSuggestions(projects: Project[], levels: TopicLevel[], topics: TopicRef[]): ProjectSuggestion[] {
  return projects.flatMap((p) => {
    for (const m of p.milestones) {
      const [topic] = blockedTopics(m, levels, topics);
      if (topic) return [{ projectId: p.id, projectTitle: p.title, milestoneId: m.id, milestoneTitle: m.title, topic }];
    }
    return [];
  });
}

export const progress = (p: Project) => ({ done: p.milestones.filter((m) => m.doneAt).length, total: p.milestones.length });
