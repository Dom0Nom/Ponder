import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  FileText,
  GraduationCap,
  Layers,
  Leaf,
  ListChecks,
  ListTodo,
  Map as MapIcon,
  NotebookPen,
  PencilLine,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "../../components/ui/misc";
import { api } from "../../lib/ipc";
import { useCourses, useCurriculum, useDueCounts, useJournal } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { dayLabel } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { CoursePanel } from "../placement/CourseCard";
import { PlanPanel } from "../placement/PlanCard";
import { FlashcardsPanel } from "../cards/FlashcardsCard";
import { Calculator } from "../calculator/Calculator";
import { FocusView } from "../focus/FocusView";
import { LowEnergyView } from "../focus/LowEnergyView";
import { MicroStepsView } from "../focus/MicroSteps";
import { StudioTimer } from "../focus/StudioTimer";
import { useLowEnergy } from "../focus/useLowEnergy";
import { StepCheckerPanel } from "../steps/StepChecker";
import { JournalView } from "./JournalView";
import { SpaceSettingsPanel } from "./SpaceSettingsPanel";
import { useStudioRecent, type RecentItem } from "./useStudioRecent";

const RECENT_ICON: Record<RecentItem["kind"], LucideIcon> = {
  quiz: ListTodo,
  cards: Layers,
  course: GraduationCap,
  journal: FileText,
};

function Meta({ loading, error, children }: { loading: boolean; error: boolean; children: ReactNode }) {
  if (loading) return <Skeleton className="mt-1 h-3 w-16" />;
  if (error) return <span className="mt-px text-label leading-[1.3] text-danger">{s.studio.loadFailed}</span>;
  return <span className="mt-px max-w-full truncate text-label leading-[1.3] text-muted">{children}</span>;
}

function Tile({
  icon: Icon,
  name,
  onClick,
  testId,
  disabled,
  children,
}: {
  icon: LucideIcon;
  name: string;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-pane border border-selected p-3 text-left text-body transition-colors hover:border-hover hover:bg-fill-subtle disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex h-5.75 items-center">
        <Icon size={16} />
      </span>
      <span className="flex min-w-0 max-w-full flex-col items-start">
        <span className="font-semibold leading-tight">{name}</span>
        {children}
      </span>
    </button>
  );
}

function ToolGrid({ space }: { space: Space }) {
  const navigate = useUi((st) => st.navigate);
  const setStudioView = useUi((st) => st.setStudioView);
  const low = useLowEnergy(space.id);
  const counts = useDueCounts();
  const abilities = useQuery({ queryKey: ["abilities", space.id], queryFn: () => api.abilitiesList(space.id) });
  const cur = useCurriculum(space.id);
  const courses = useCourses(space.id);
  const journal = useJournal(space.id);

  const row = counts.data?.find((x) => x.spaceId === space.id);
  const topics = abilities.data?.length ?? 0;
  const course = courses.data ?? [];
  const lessons = course.length === 1 ? course[0].lessons : [];
  const pct = lessons.length ? Math.round((lessons.filter((l) => l.status === "done").length / lessons.length) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-2 px-4 pt-4">
      <Tile icon={Layers} name={s.studio.flashcards} testId="flashcards-tile" onClick={() => setStudioView("flashcards")}>
        <Meta loading={counts.isLoading} error={!!counts.error}>
          {row && row.due > 0 ? s.studio.due(row.due) : row && row.total > 0 ? s.studio.noneDue : s.studio.noCards}
        </Meta>
      </Tile>
      <Tile
        icon={PencilLine}
        name={s.studio.practice}
        testId="practice-button"
        disabled={low.active}
        onClick={() => navigate({ name: "practice", spaceId: space.id })}
      >
        <Meta loading={abilities.isLoading} error={!!abilities.error}>
          {low.active ? s.focus.lowEnergy.disabledReason : topics > 0 ? s.studio.topics(topics) : s.studio.practiceStart}
        </Meta>
      </Tile>
      <Tile icon={ListChecks} name={s.studio.steps} testId="step-checker-button" onClick={() => setStudioView("steps")}>
        <Meta loading={false} error={false}>
          {s.studio.stepsMeta}
        </Meta>
      </Tile>
      <Tile icon={MapIcon} name={s.studio.plan} testId="plan-tile" onClick={() => setStudioView("plan")}>
        <Meta loading={cur.isLoading} error={!!cur.error}>
          {cur.data ? cur.data.title : s.studio.planPick}
        </Meta>
      </Tile>
      <Tile icon={GraduationCap} name={s.studio.course} testId="course-tile" onClick={() => setStudioView("course")}>
        <Meta loading={courses.isLoading} error={!!courses.error}>
          {course.length === 0 ? s.studio.courseNone : course.length === 1 ? s.studio.coursePct(pct) : s.studio.courses(course.length)}
        </Meta>
      </Tile>
      <Tile icon={NotebookPen} name={s.studio.journal} onClick={() => setStudioView("journal")}>
        <Meta loading={journal.isLoading} error={!!journal.error}>
          {journal.data?.length ? s.studio.entries(journal.data.length) : s.studio.noEntries}
        </Meta>
      </Tile>
    </div>
  );
}

function Recent({ spaceId }: { spaceId: string }) {
  const setStudioView = useUi((st) => st.setStudioView);
  const items = useStudioRecent(spaceId);
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="px-4 pb-1.5 pt-5.5 text-label font-semibold text-muted">{s.studio.recent}</h3>
      <ul className="mx-4 border-t border-divider">
        {items.map((x) => {
          const Icon = RECENT_ICON[x.kind];
          return (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setStudioView(x.view)}
                className="-mx-1 flex h-9.75 w-[calc(100%+8px)] items-center gap-2.5 border-b border-divider px-1 text-left text-body hover:bg-fill-subtle"
              >
                <Icon size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
                <span className="shrink-0 text-label text-muted">{dayLabel(x.at)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LowEnergyRow() {
  const setStudioView = useUi((st) => st.setStudioView);
  return (
    <button
      type="button"
      onClick={() => setStudioView("lowEnergy")}
      className="mx-4 mt-4 flex min-h-13 shrink-0 items-center gap-3 rounded-card border border-border px-3.5 text-left text-body hover:bg-fill-subtle"
    >
      <Leaf size={15} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{s.studio.lowEnergyRow}</span>
        <span className="text-label text-muted">{s.studio.lowEnergyMeta}</span>
      </span>
      <ChevronRight size={14} />
    </button>
  );
}

function MainView({ space }: { space: Space }) {
  const setStudioView = useUi((st) => st.setStudioView);
  const low = useLowEnergy(space.id);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <StudioTimer />
      {low.active && <LowEnergyRow />}
      <ToolGrid space={space} />
      <Recent spaceId={space.id} />
      <button
        type="button"
        onClick={() => setStudioView("settings")}
        className="mt-auto flex shrink-0 items-center gap-2 border-t border-divider px-4 py-[10.5px] text-left text-body font-medium text-fg-secondary hover:text-fg"
      >
        <SlidersHorizontal size={14} />
        {s.studio.settings}
      </button>
    </div>
  );
}

export function StudioPanel({ space }: { space: Space }) {
  const view = useUi((st) => st.studioView);
  const from = useUi((st) => st.studioFrom);
  const setStudioView = useUi((st) => st.setStudioView);
  const back = () => setStudioView(from);

  switch (view) {
    case null:
      return <MainView space={space} />;
    case "focus":
      return <FocusView space={space} onBack={back} />;
    case "microsteps":
      return <MicroStepsView space={space} onBack={back} />;
    case "lowEnergy":
      return <LowEnergyView space={space} onBack={back} />;
    case "journal":
      return <JournalView spaceId={space.id} onBack={back} />;
    case "settings":
      return <SpaceSettingsPanel space={space} onBack={back} />;
    case "flashcards":
      return <FlashcardsPanel space={space} onBack={back} />;
    case "steps":
      return <StepCheckerPanel spaceId={space.id} onBack={back} />;
    case "plan":
      return <PlanPanel space={space} onBack={back} />;
    case "course":
      return <CoursePanel space={space} onBack={back} />;
    case "calculator":
      return (
        <div className="flex h-full min-h-0 flex-col">
          <StudioTimer />
          <div className="min-h-0 flex-1 overflow-hidden">
            <Calculator fit popOut />
          </div>
        </div>
      );
  }
}
