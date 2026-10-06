import type { Space } from "../../lib/types";
import { FocusPanel } from "../focus/FocusPanel";
import { SpaceSettingsCard } from "./SpaceSettingsCard";
import { JournalCard } from "./JournalCard";
import { PlanCard } from "../placement/PlanCard";
import { FlashcardsCard } from "../cards/FlashcardsCard";
import { CourseCard } from "../placement/CourseCard";
import { StepCheckerButton } from "../steps/StepChecker";
import { LowEnergyCard } from "../focus/LowEnergyCard";
import { useLowEnergy } from "../focus/useLowEnergy";
import { PracticeCard } from "../practice/PracticeCard";

export function StudioPane({ space }: { space: Space }) {
  const low = useLowEnergy(space.id);
  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <FocusPanel spaceId={space.id} />
      {low.active && <LowEnergyCard space={space} />}
      <FlashcardsCard space={space} />
      {!low.active && <PracticeCard space={space} />}
      <StepCheckerButton spaceId={space.id} />
      <PlanCard space={space} />
      <CourseCard space={space} />
      <SpaceSettingsCard space={space} />
      <JournalCard spaceId={space.id} />
    </div>
  );
}
