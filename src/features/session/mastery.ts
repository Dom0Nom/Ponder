import { api } from "../../lib/ipc";
import { appNow } from "../../lib/plan/clock";
import { applyRetest, markLearned, retestPassed, RETEST_QUESTIONS, statusOf } from "../../lib/insights/mastery";
import { queryClient, qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { toast, toastError } from "../../components/ui/toast";

const tally = new Map<string, { correct: number; total: number }>();

const refresh = (spaceId: string) => queryClient.invalidateQueries({ queryKey: qk.mastery(spaceId) });

/** A topic reached the "learned" level in practice: starts the 3-day wait. */
export async function noteLearned(spaceId: string, topicKey: string) {
  try {
    const [rows, now] = await Promise.all([api.masteryList(spaceId), Promise.resolve(appNow())]);
    const row = rows.find((r) => r.topicKey === topicKey) ?? null;
    const next = markLearned(row, topicKey, now);
    if (next === row) return;
    await api.masteryUpsert(spaceId, next);
    refresh(spaceId);
  } catch (e) {
    toastError(s.errors.generic, e);
  }
}

/** Counts practice answers on a topic whose retest is due; after three, passes or fails the retest. */
export async function noteRetestAnswer(spaceId: string, topicKey: string, topicTitle: string, correct: boolean) {
  try {
    const [rows, now] = await Promise.all([api.masteryList(spaceId), Promise.resolve(appNow())]);
    const row = rows.find((r) => r.topicKey === topicKey);
    if (!row || statusOf(row, now) !== "retest") return;
    const key = `${spaceId}:${topicKey}`;
    const t = tally.get(key) ?? { correct: 0, total: 0 };
    t.total++;
    if (correct) t.correct++;
    tally.set(key, t);
    if (t.total < RETEST_QUESTIONS) return;
    tally.delete(key);
    const passed = retestPassed(t.correct, t.total);
    await api.masteryUpsert(spaceId, applyRetest(row, passed, now));
    refresh(spaceId);
    toast(passed ? s.mastery.retestPassed(topicTitle) : s.mastery.retestFailed(topicTitle));
  } catch (e) {
    toastError(s.errors.generic, e);
  }
}
