import { api } from "../ipc";
import type { Course } from "../types";
import type { PlanTopic, ReplanContext } from "./schedule";

export interface ScheduleContext extends ReplanContext {
  topics: PlanTopic[];
  lessons: { id: string; title: string }[];
  doneTopicIds: string[];
  curriculumTitle: string | null;
}

export function lessonsOf(courses: Course[]) {
  const all = courses.flatMap((c) => c.lessons);
  return { lessons: all.map((l) => ({ id: l.id, title: l.title })), doneIds: all.filter((l) => l.status === "done").map((l) => l.id) };
}

export async function loadScheduleContext(spaceId: string): Promise<ScheduleContext> {
  const [cur, levels, courses, due] = await Promise.all([
    api.curriculumGet(spaceId),
    api.topicLevels(spaceId),
    api.coursesList(spaceId),
    api.cardsDueCounts(),
  ]);
  const level = new Map(levels.map((l) => [l.topicId, l.level]));
  const { lessons, doneIds } = lessonsOf(courses);
  return {
    topics: (cur?.topics ?? []).map((t) => ({ id: t.id, title: t.title, prereqs: t.prereqs, level: level.get(t.id) ?? "unknown" })),
    lessons,
    doneTopicIds: doneIds,
    hasCards: (due.find((d) => d.spaceId === spaceId)?.total ?? 0) > 0,
    curriculumTitle: cur?.title ?? null,
  };
}
