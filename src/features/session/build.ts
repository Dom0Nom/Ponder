import { api } from "../../lib/ipc";
import { appNow } from "../../lib/plan/clock";
import { todayDate } from "../../lib/plan/clock";
import { projectSuggestions } from "../../lib/projects/blocked";
import { retestsDue, statusOf } from "../../lib/insights/mastery";
import { DEFAULT_MINUTES, nextSession, type Block, type NextInput, type TopicLite } from "../../lib/session/engine";
import type { TopicRef } from "../../lib/types";
import { useFocusStore } from "../focus/focusStore";

const DAY = 86_400_000;

export interface Built {
  spaceId: string;
  input: NextInput;
  blocks: Block[];
}

function frontierOf(topics: TopicRef[], learned: Set<string>): TopicLite | null {
  const open = topics.filter((t) => !learned.has(t.id));
  const ready = open.find((t) => (t.prereqs ?? []).every((p) => learned.has(p) || !topics.some((x) => x.id === p)));
  const pick = ready ?? open[0];
  return pick ? { key: pick.id, title: pick.title } : null;
}

export async function buildNext(spaceId: string, minutes = DEFAULT_MINUTES): Promise<Built> {
  const now = appNow();
  const [curriculum, levels, counts, mastery, tasks, activity, projects] = await Promise.all([
    api.curriculumGet(spaceId),
    api.topicLevels(spaceId),
    api.cardsDueCounts(),
    api.masteryList(spaceId),
    api.listPlanTasks(todayDate(), todayDate()),
    api.insightsActivity(spaceId, now - DAY),
    api.projectsList(spaceId),
  ]);
  const topics = curriculum?.topics ?? [];
  const title = new Map(topics.map((t) => [t.id, t.title]));
  const lite = (key: string): TopicLite => ({ key, title: title.get(key) ?? key });
  const learned = new Set([
    ...levels.filter((l) => l.level === "ok" || l.level === "strong").map((l) => l.topicId),
    ...mastery.filter((m) => m.state !== "learning").map((m) => m.topicKey),
  ]);
  const mastered = new Set(mastery.filter((m) => statusOf(m, now) === "mastered").map((m) => m.topicKey));

  const wrongKeys = new Set(activity.attempts.filter((a) => !a.correct).map((a) => a.topicKey));
  const prereqs = new Set<string>();
  for (const t of topics) if (wrongKeys.has(t.id)) for (const p of t.prereqs ?? []) if (title.has(p) && !mastered.has(p)) prereqs.add(p);

  const focus = useFocusStore.getState().state;
  const input: NextInput = {
    goal: null,
    minutes,
    lowEnergy: !!focus && focus.energy === "low" && focus.spaceId === spaceId,
    dueCards: counts.find((c) => c.spaceId === spaceId)?.due ?? 0,
    retests: retestsDue(mastery, now).map((r) => lite(r.topicKey)),
    prereqChecks: [...prereqs].map(lite),
    frontier: frontierOf(topics, learned),
    projects: projectSuggestions(projects, levels, topics).map((p) => ({ projectId: p.projectId, projectTitle: p.projectTitle, topic: { key: p.topic.id, title: p.topic.title } })),
    planToday: tasks.filter((t) => t.spaceId === spaceId && !t.doneAt).map((t) => t.title),
    hasTopics: topics.length > 0 || levels.length > 0,
  };
  return { spaceId, input, blocks: nextSession(input) };
}
