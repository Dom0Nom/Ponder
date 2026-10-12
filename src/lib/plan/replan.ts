import { api } from "../ipc";
import { qk, queryClient } from "../queries";
import { todayDate } from "./clock";
import { loadScheduleContext } from "./context";
import { replanIfMissed } from "./schedule";

const key = (spaceId: string) => `plan-replan:${spaceId}`;
const running = new Map<string, Promise<number>>();

function checkedToday(spaceId: string, today: string) {
  try {
    return localStorage.getItem(key(spaceId)) === today;
  } catch {
    return false;
  }
}

function markChecked(spaceId: string, today: string) {
  try {
    localStorage.setItem(key(spaceId), today);
  } catch {
    /* storage unavailable: the check runs again on the next mount */
  }
}

export function invalidatePlans(spaceId: string) {
  queryClient.invalidateQueries({ queryKey: qk.studyPlan(spaceId) });
  queryClient.invalidateQueries({ queryKey: qk.planTasks });
}

/** Once per day per space: moves missed tasks forward. Resolves to how many were moved. */
export function replanSpaceOnce(spaceId: string): Promise<number> {
  const today = todayDate();
  if (checkedToday(spaceId, today)) return Promise.resolve(0);
  const live = running.get(spaceId);
  if (live) return live.then(() => 0);
  const job = (async () => {
    const bundle = await api.getStudyPlan(spaceId);
    if (!bundle) return 0;
    const result = replanIfMissed(bundle.plan, bundle.tasks, today, await loadScheduleContext(spaceId));
    if (!result) {
      markChecked(spaceId, today);
      return 0;
    }
    await api.saveStudyPlan(spaceId, bundle.plan, true, result.tasks);
    markChecked(spaceId, today);
    invalidatePlans(spaceId);
    return result.moved;
  })().finally(() => running.delete(spaceId));
  running.set(spaceId, job);
  return job;
}
