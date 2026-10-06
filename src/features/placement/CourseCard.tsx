import { useState } from "react";
import { BookOpenCheck, CheckCircle2, Circle, CircleDot, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useCourses } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Course, Lesson, Space } from "../../lib/types";
import { checkLesson, studyLesson } from "../../lib/placement/flows";
import { NoModelError } from "../../lib/chat/llm";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Skeleton } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";

const STATUS_ICON = { todo: Circle, doing: CircleDot, done: CheckCircle2 } as const;

export function CourseCard({ space }: { space: Space }) {
  const { data, isLoading, error } = useCourses(space.id);
  if (isLoading) return <Skeleton className="h-16 rounded-[var(--radius-card)]" />;
  if (error) return <p className="text-xs text-danger">{(error as Error).message}</p>;
  if (!data?.length) return null;
  return (
    <>
      {data.map((c) => (
        <CourseBlock key={c.id} space={space} course={c} />
      ))}
    </>
  );
}

function CourseBlock({ space, course }: { space: Space; course: Course }) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const done = course.lessons.filter((l) => l.status === "done").length;

  const act = async (lesson: Lesson, kind: "study" | "check") => {
    setBusy(lesson.id);
    try {
      if (kind === "study") await studyLesson(space, course, lesson);
      else {
        const score = await checkLesson(space, course, lesson);
        if (score != null) toast.success(score >= 2 / 3 ? s.course.passed : s.course.notYet);
      }
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.errors.generic, e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-border p-4" data-testid="course-card">
      <div className="mb-2 flex items-start gap-2">
        <BookOpenCheck size={15} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{course.title}</p>
          <p className="text-xs text-muted">{s.course.progress(done, course.lessons.length)}</p>
        </div>
        <button aria-label={s.common.delete} onClick={() => setDeleting(true)} className="rounded-full p-1 text-muted hover:bg-danger-soft hover:text-danger">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full bg-accent" style={{ width: `${(done / Math.max(1, course.lessons.length)) * 100}%` }} />
      </div>
      <ol className="space-y-0.5">
        {course.lessons.map((l) => {
          const Icon = STATUS_ICON[l.status];
          return (
            <li key={l.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 text-xs hover:bg-surface-2" data-testid="lesson-row" data-status={l.status}>
              <Icon size={13} className={l.status === "done" ? "shrink-0 text-success" : "shrink-0 text-muted"} />
              <span className="min-w-0 flex-1 truncate">{l.title}</span>
              <span className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button disabled={!!busy} onClick={() => act(l, "study")} className="rounded-full px-2 py-0.5 font-medium text-accent-text hover:bg-accent-soft">
                  {s.course.study}
                </button>
                <button disabled={!!busy} onClick={() => act(l, "check")} className="rounded-full px-2 py-0.5 font-medium text-accent-text hover:bg-accent-soft">
                  {s.course.check}
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={s.course.deleteTitle}
        body={s.course.deleteBody}
        confirmLabel={s.common.delete}
        danger
        onConfirm={async () => {
          try {
            await api.courseDelete(course.id);
            qc.invalidateQueries({ queryKey: qk.courses(space.id) });
          } catch (e) {
            toastError(s.errors.generic, e);
          }
        }}
      />
    </div>
  );
}
