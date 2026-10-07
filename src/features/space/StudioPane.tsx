import { BookOpenCheck, Layers, ListChecks, Map as MapIcon } from "lucide-react";
import type { Space } from "../../lib/types";
import { s } from "../../lib/strings";
import { useUi, type StudioView } from "../../stores/ui";
import { FocusPanel } from "../focus/FocusPanel";
import { SpaceSettingsCard } from "./SpaceSettingsCard";
import { JournalCard } from "./JournalCard";
import { PlanPanel } from "../placement/PlanCard";
import { FlashcardsPanel } from "../cards/FlashcardsCard";
import { CoursePanel } from "../placement/CourseCard";
import { StepCheckerPanel } from "../steps/StepChecker";
import { LowEnergyCard } from "../focus/LowEnergyCard";
import { useLowEnergy } from "../focus/useLowEnergy";
import { PracticeCard } from "../practice/PracticeCard";

const TILES = [
  { view: "flashcards", label: s.cards.title, icon: Layers, testId: "flashcards-tile" },
  { view: "steps", label: s.steps.open, icon: ListChecks, testId: "step-checker-button" },
  { view: "plan", label: s.plan.title, icon: MapIcon, testId: "plan-tile" },
  { view: "course", label: s.course.title, icon: BookOpenCheck, testId: "course-tile" },
] as const satisfies readonly { view: StudioView; label: string; icon: unknown; testId: string }[];

export function StudioPane({ space }: { space: Space }) {
  const low = useLowEnergy(space.id);
  const view = useUi((st) => st.studioView);
  const setView = useUi((st) => st.setStudioView);
  const back = () => setView(null);

  if (view === "flashcards") return <FlashcardsPanel space={space} onBack={back} />;
  if (view === "steps") return <StepCheckerPanel spaceId={space.id} onBack={back} />;
  if (view === "plan") return <PlanPanel space={space} onBack={back} />;
  if (view === "course") return <CoursePanel space={space} onBack={back} />;

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <FocusPanel spaceId={space.id} />
      {low.active && <LowEnergyCard space={space} />}
      <div className="grid grid-cols-2 gap-2">
        {TILES.map(({ view: v, label, icon: Icon, testId }) => (
          <button
            key={v}
            data-testid={testId}
            onClick={() => setView(v)}
            className="flex h-[42px] items-center gap-2.5 rounded-card border border-border px-3 text-left font-medium hover:bg-fill-faint"
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {!low.active && <PracticeCard space={space} />}
      <SpaceSettingsCard space={space} />
      <JournalCard spaceId={space.id} />
    </div>
  );
}
