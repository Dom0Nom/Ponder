import { useEffect, useMemo } from "react";
import { Play } from "lucide-react";
import { todayDate } from "../../lib/plan/clock";
import { replanSpaceOnce } from "../../lib/plan/replan";
import { useAllPlanTasks, useDueCounts } from "../../lib/queries";
import { SpaceIcon } from "../../lib/spaceStyle";
import { s } from "../../lib/strings";
import type { DatedPlanTask } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { ErrorState } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { TaskRow } from "./TaskRow";

/** Shared by the Home screen and the palette: whether any study plan exists. */
export function useHasPlan() {
  const { data } = useAllPlanTasks();
  return (data?.length ?? 0) > 0;
}

export function TodaySection() {
  const tasks = useAllPlanTasks();
  const due = useDueCounts();
  const navigate = useUi((st) => st.navigate);
  const openFocusDialog = useUi((st) => st.openFocusDialog);
  const today = todayDate();

  const spaceIds = useMemo(() => [...new Set((tasks.data ?? []).map((t) => t.spaceId))].sort(), [tasks.data]);
  const spaceKey = spaceIds.join(",");
  useEffect(() => {
    for (const id of spaceKey ? spaceKey.split(",") : [])
      replanSpaceOnce(id)
        .then((n) => n > 0 && toast(s.plan.schedule.replanned(n)))
        .catch((e) => toastError(s.plan.schedule.saveFailed, e));
  }, [spaceKey, today]);

  const groups = useMemo(() => {
    const by = new Map<string, DatedPlanTask[]>();
    for (const t of tasks.data ?? []) if (t.date === today) by.set(t.spaceId, [...(by.get(t.spaceId) ?? []), t]);
    return [...by.values()];
  }, [tasks.data, today]);

  if (tasks.error) return <ErrorState size="sm" title={s.home.today.loadFailed} error={tasks.error} onRetry={() => tasks.refetch()} />;
  if (!tasks.data || tasks.data.length === 0) return null;

  const planned = new Set(spaceIds);
  const dueCards = (due.data ?? []).filter((d) => planned.has(d.spaceId)).reduce((n, d) => n + d.due, 0);

  const start = (t: DatedPlanTask) => {
    navigate({ name: "space", spaceId: t.spaceId });
    openFocusDialog(t.title);
  };

  return (
    <section id="today" aria-labelledby="today-heading" className="flex scroll-mt-6 flex-col gap-3" data-testid="today-section">
      <h2 id="today-heading" className="text-section font-semibold">
        {s.home.today.title}
      </h2>
      {groups.length === 0 && (
        <p className="text-muted" data-testid="today-empty">
          {s.home.today.empty}
        </p>
      )}
      {groups.map((list) => (
        <div key={list[0].spaceId} className="rounded-card border border-border bg-surface px-4 py-3" data-testid="today-group">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <SpaceIcon icon={list[0].spaceIcon} tile={false} size={15} />
            <span className="truncate">{list[0].spaceName}</span>
          </div>
          {list.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              action={
                <Button size="sm" variant="secondary" aria-label={s.home.today.startTask(t.title)} onClick={() => start(t)}>
                  <Play size={13} />
                  {s.home.today.start}
                </Button>
              }
            />
          ))}
        </div>
      ))}
      {dueCards > 0 && (
        <div className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3" data-testid="today-cards">
          <span className="flex-1 font-medium">{s.home.today.cards(dueCards)}</span>
          <Button size="sm" variant="secondary" onClick={() => navigate({ name: "review" })}>
            {s.home.today.review}
          </Button>
        </div>
      )}
    </section>
  );
}
