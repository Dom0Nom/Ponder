import type { Space } from "../../lib/types";
import { FocusPanel } from "../focus/FocusPanel";
import { SpaceSettingsCard } from "./SpaceSettingsCard";
import { JournalCard } from "./JournalCard";
import { PlanCard } from "../placement/PlanCard";
import { FlashcardsCard } from "../cards/FlashcardsCard";
import { CourseCard } from "../placement/CourseCard";

export function StudioPane({ space }: { space: Space }) {
  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <FocusPanel spaceId={space.id} />
      <FlashcardsCard space={space} />
      <PlanCard space={space} />
      <CourseCard space={space} />
      <SpaceSettingsCard space={space} />
      <JournalCard spaceId={space.id} />
    </div>
  );
}
