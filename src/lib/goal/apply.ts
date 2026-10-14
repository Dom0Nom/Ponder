import { api } from "../ipc";
import { qk, queryClient } from "../queries";
import { todayDate } from "../plan/clock";
import { loadScheduleContext } from "../plan/context";
import { invalidatePlans } from "../plan/replan";
import { buildSchedule, type ScheduleError } from "../plan/schedule";
import { knownLevels, toTopicRefs, validateGraph } from "../placement/graph";
import type { GoalGraph, GoalKind } from "../types";

export interface GoalPlanInput {
  spaceId: string;
  kind: GoalKind;
  curriculumId: string;
  title: string;
  graph: GoalGraph;
  /** empty for a goal without a date */
  examDate: string;
  weeklyMinutes: number;
  studyDays: number[];
}

export type ApplyError = ScheduleError | "allKnown" | "graph";

/** Saves the graph as the space's curriculum and goal, applies "I know this", and writes the schedule. */
export async function applyGoal(input: GoalPlanInput): Promise<{ ok: true } | { ok: false; error: ApplyError }> {
  const { spaceId, graph } = input;
  if (validateGraph(graph).length) return { ok: false, error: "graph" };
  const known = knownLevels(graph);
  if (known.length === graph.nodes.length) return { ok: false, error: "allKnown" };

  await api.curriculumSet(spaceId, input.curriculumId, input.title, toTopicRefs(graph));
  for (const k of known) await api.topicLevelSet(spaceId, k.id, k.level, "marked as known");
  const ctx = await loadScheduleContext(spaceId);
  const result = buildSchedule({
    today: todayDate(),
    examDate: input.examDate,
    weeklyMinutes: input.weeklyMinutes,
    studyDays: input.studyDays,
    topics: ctx.topics,
    lessons: ctx.lessons,
    doneTopicIds: [...ctx.doneTopicIds, ...known.map((k) => k.id)],
    hasCards: ctx.hasCards,
  });
  if (!result.ok) return { ok: false, error: result.error };
  await api.goalSave(spaceId, input.kind, input.title, graph);
  await api.saveStudyPlan(spaceId, { goal: input.title, examDate: input.examDate, weeklyMinutes: input.weeklyMinutes, studyDays: input.studyDays }, false, result.tasks);
  for (const key of [qk.curriculum(spaceId), qk.levels(spaceId), qk.goal(spaceId)]) queryClient.invalidateQueries({ queryKey: key });
  invalidatePlans(spaceId);
  return { ok: true };
}
