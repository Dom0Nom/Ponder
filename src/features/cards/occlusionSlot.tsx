import type { Card } from "../../lib/types";
import { OcclusionCardView } from "./OcclusionCardView";
import { OcclusionEditorButton } from "./OcclusionEditorButton";

export function OcclusionSlot({ card, revealed }: { card: Card; revealed: boolean }) {
  return <OcclusionCardView card={card} revealed={revealed} />;
}

export function OcclusionButtonSlot({ spaceId }: { spaceId: string }) {
  return <OcclusionEditorButton spaceId={spaceId} variant="ghost" size="sm" />;
}
