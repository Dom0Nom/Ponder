import { useState } from "react";
import { Circle, CircleCheck, CircleDot, Ellipsis } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useCourses } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Course, Lesson, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { checkLesson, studyLesson } from "../../lib/placement/flows";
import { NoModelError } from "../../lib/chat/llm";
import { IconSwap } from "../../components/motion/IconSwap";
import { TextSwap } from "../../components/motion/TextSwap";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { Skeleton } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { PanelList, panelRow } from "../space/PanelList";
import { StudioSubpanel } from "../space/StudioSubpanel";

const STATUS_ICON = { todo: Circle, doing: CircleDot, done: CircleCheck } as const;
const REVEAL = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100";

export function CoursePanel({ space, onBack }: { space: Space; onBack: () => void }) {
  const { data, isLoading, error } = useCourses(space.id);
  return (
    <StudioSubpanel title={s.course.title} onBack={onBack} testId="course-panel">
      {isLoading && <Skeleton className="h-16 rounded-card" />}
      {error && <p className="text-danger">{(error as Error).message}</p>}
      {data && !data.length && <p className="text-muted">{s.course.makeHelp}</p>}
      {data?.map((c) => (
        <CourseBlock key={c.id} space={space} course={c} />
      ))}
    </StudioSubpanel>
  );
}

function CourseBlock({ space, course }: { space: Space; course: Course }) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const done = course.lessons.filter((l) => l.status === "done").length;
  const pct = (done / Math.max(1, course.lessons.length)) * 100;

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
    <div className="flex flex-col gap-3.5" data-testid="course-card">
      <div className="group flex flex-col gap-1.5">
        <div className="relative flex items-center gap-2">
          <span className="flex-1 truncate text-input font-semibold">{course.title}</span>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost-muted" size="icon-sm" className={cn(REVEAL, "absolute right-0 top-1/2 -translate-y-1/2 data-[state=open]:opacity-100")} title={s.course.options} aria-label={s.course.options}>
                <Ellipsis size={15} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="w-[180px]">
              <MenuItem danger onSelect={() => setDeleting(true)}>
                {s.common.delete}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="block h-1 w-[140px] flex-none rounded-[2px] bg-fill-active">
            <span className="m-progress block h-1 rounded-[2px] bg-fg" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-muted">
            <TextSwap text={s.course.progress(done, course.lessons.length)} />
          </span>
        </div>
      </div>
      <PanelList inset={14}>
        {course.lessons.map((l) => {
          return (
            <div key={l.id} className={cn(panelRow, "group h-10 gap-2.5")} data-testid="lesson-row" data-status={l.status}>
              <IconSwap value={l.status} icons={STATUS_ICON} className="flex-none" />
              <span className={cn("min-w-0 flex-1 truncate", l.status === "done" ? "font-medium text-muted" : l.status === "doing" ? "font-semibold" : "font-medium")}>
                {l.title}
              </span>
              <Button variant="ghost" size="sm" className={REVEAL} disabled={!!busy} onClick={() => act(l, "study")}>
                {s.course.study}
              </Button>
              <Button variant="ghost" size="sm" className={l.status === "doing" ? "" : REVEAL} disabled={!!busy} onClick={() => act(l, "check")}>
                {s.course.check}
              </Button>
            </div>
          );
        })}
      </PanelList>
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
