import { FeynmanPanel } from "../feynman/FeynmanPanel";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  GraduationCap,
  Layers,
  Leaf,
  ListChecks,
  ListTodo,
  Map as MapIcon,
  NotebookPen,
  PencilLine,
  Shapes,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "../../components/ui/misc";
import { LearnChevron } from "../../components/motion/LearnChevron";
import { api } from "../../lib/ipc";
import { todayDate } from "../../lib/plan/clock";
import { weekInfo } from "../../lib/plan/schedule";
import { useCourses, useCurriculum, useDueCounts, useJournal, useStudyPlan } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { cn, dayLabel } from "../../lib/utils";
import { useUi, type StudioView } from "../../stores/ui";
import { usePageSlide } from "../../components/motion/usePageSlide";
import { CoursePanel } from "../placement/CourseCard";
import { PlanPanel } from "../placement/PlanCard";
import { FlashcardsPanel } from "../cards/FlashcardsCard";
import { CalculatorPanel } from "../calculator/CalculatorPanel";
import { FocusView } from "../focus/FocusView";
import { LowEnergyView } from "../focus/LowEnergyView";
import { MicroStepsView } from "../focus/MicroSteps";
import { StudioTimer } from "../focus/StudioTimer";
import { useLowEnergy } from "../focus/useLowEnergy";
import { StepCheckerPanel } from "../steps/StepChecker";
import { CreatePanel } from "../outputs/CreatePanel";
import { KIND_ICON } from "../outputs/kindIcons";
import { JournalView } from "./JournalView";
import { SpaceSettingsPanel } from "./SpaceSettingsPanel";
import { useStudioRecent, type RecentItem } from "./useStudioRecent";

const RECENT_ICON: Record<RecentItem["kind"], LucideIcon> = {
  quiz: ListTodo,
  cards: Layers,
  course: GraduationCap,
  journal: FileText,
  output: Shapes,
};

function Meta({ loading, error, children }: { loading: boolean; error: boolean; children: ReactNode }) {
  return (
    <span className={cn("t-skel mt-px block h-[15.6px] min-w-20 max-w-full", !loading && "is-revealed")}>
      <Skeleton className="rounded-[3px]" />
      <span
        className={cn("t-skel-content !static block truncate text-label leading-[1.3]", error ? "text-danger" : "text-muted")}
      >
        {loading ? null : error ? s.studio.loadFailed : children}
      </span>
    </span>
  );
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
      className="flex flex-col items-start gap-2 rounded-pane border border-selected p-3 text-start text-body transition-colors hover:border-hover hover:bg-fill-subtle disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex h-[23.2px] items-center">
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
  const plan = useStudyPlan(space.id);
  const week = plan.data ? weekInfo(plan.data.plan, todayDate()) : { current: 1, total: 1 };
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
        <Meta loading={cur.isLoading || plan.isLoading} error={!!cur.error || !!plan.error}>
          {plan.data ? s.studio.planWeek(week.current, week.total) : cur.data ? cur.data.title : s.studio.planPick}
        </Meta>
      </Tile>
      <Tile icon={GraduationCap} name={s.studio.course} testId="course-tile" onClick={() => setStudioView("course")}>
        <Meta loading={courses.isLoading} error={!!courses.error}>
          {course.length === 0 ? s.studio.courseNone : course.length === 1 ? s.studio.coursePct(pct / 100) : s.studio.courses(course.length)}
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
  const navigate = useUi((st) => st.navigate);
  const items = useStudioRecent(spaceId);
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="px-4 pb-1.5 pt-5.5 text-label font-semibold text-muted">{s.studio.recent}</h3>
      <ul className="mx-4 border-t border-divider">
        {items.map((x) => {
          const Icon = x.output ? KIND_ICON[x.output.kind] : RECENT_ICON[x.kind];
          return (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => (x.output ? navigate({ name: "output", spaceId, outputId: x.output.id }) : setStudioView(x.view))}
                className="-mx-1 flex h-9.75 w-[calc(100%+8px)] items-center gap-2.5 border-b border-divider px-1 text-start text-body hover:bg-fill-subtle"
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
      className="t-learn mx-4 mt-4 flex min-h-13 shrink-0 items-center gap-3 rounded-card border border-border px-3.5 text-start text-body hover:bg-fill-subtle"
    >
      <Leaf size={15} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{s.studio.lowEnergyRow}</span>
        <span className="text-label text-muted">{s.studio.lowEnergyMeta}</span>
      </span>
      <LearnChevron size={14} />
    </button>
  );
}

function CreateRow() {
  const setStudioView = useUi((st) => st.setStudioView);
  return (
    <button
      type="button"
      onClick={() => setStudioView("create")}
      data-testid="create-row"
      className="mx-4 mb-4 mt-4 flex min-h-13 shrink-0 items-center gap-3 rounded-card border border-border px-3.5 text-start text-body hover:bg-fill-subtle"
    >
      <Shapes size={15} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{s.outputs.row}</span>
        <span className="truncate text-label text-muted">{s.outputs.rowMeta}</span>
      </span>
      <LearnChevron size={14} />
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
      <CreateRow />
      <button
        type="button"
        onClick={() => setStudioView("settings")}
        className="mt-auto flex shrink-0 items-center gap-2 border-t border-divider px-4 py-[10.5px] text-start text-body font-medium text-fg-secondary hover:text-fg"
      >
        <SlidersHorizontal size={14} />
        {s.studio.settings}
      </button>
    </div>
  );
}

function SubView({ space, view }: { space: Space; view: StudioView }) {
  const from = useUi((st) => st.studioFrom);
  const setStudioView = useUi((st) => st.setStudioView);
  const back = () => setStudioView(from);
  switch (view) {
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
    case "create":
      return <CreatePanel space={space} onBack={back} />;
    case "feynman":
      return <FeynmanPanel space={space} onBack={back} />;
    case "calculator":
      return (
        <div className="flex h-full min-h-0 flex-col">
          <StudioTimer />
          <div className="min-h-0 flex-1 overflow-hidden">
            <CalculatorPanel popOut />
          </div>
        </div>
      );
  }
}

export function StudioPanel({ space }: { space: Space }) {
  const view = useUi((st) => st.studioView);
  const { page, sub } = usePageSlide(view);
  return (
    <div className="t-page-slide h-full" data-page={page}>
      <div className="t-page" data-page-id="1" inert={page === 2}>
        <MainView space={space} />
      </div>
      {sub && (
        <div className="t-page" data-page-id="2" inert={page === 1}>
          <SubView space={space} view={sub} />
        </div>
      )}
    </div>
  );
}
