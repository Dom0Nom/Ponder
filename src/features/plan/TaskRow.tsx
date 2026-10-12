import type { ReactNode } from "react";
import { api } from "../../lib/ipc";
import { invalidatePlans } from "../../lib/plan/replan";
import { s } from "../../lib/strings";
import type { PlanTask } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Checkbox16 } from "../../components/ui/checkbox";
import { toastError } from "../../components/ui/toast";

export async function toggleTask(task: PlanTask, done: boolean) {
  try {
    await api.setPlanTaskDone(task.id, done);
    invalidatePlans(task.spaceId);
  } catch (e) {
    toastError(s.errors.generic, e, () => void toggleTask(task, done));
  }
}

export function TaskRow({ task, action, className }: { task: PlanTask; action?: ReactNode; className?: string }) {
  const done = !!task.doneAt;
  return (
    <div className={cn("flex min-h-9 items-center gap-2.5 py-1.5", className)} data-testid="plan-task" data-done={done}>
      <Checkbox16 checked={done} onChange={(e) => void toggleTask(task, e.target.checked)} aria-label={s.plan.schedule.markDone(task.title)} />
      <span className={cn("min-w-0 flex-1 truncate", done && "text-muted line-through")}>{task.title}</span>
      <span className="whitespace-nowrap text-label text-muted">{s.plan.schedule.taskMinutes(task.minutes)}</span>
      {action}
    </div>
  );
}

export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
