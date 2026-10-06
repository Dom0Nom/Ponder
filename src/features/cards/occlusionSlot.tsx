import type { Card } from "../../lib/types";

/** Placeholder until the occlusion card view lands. */
export function OcclusionSlot({ card }: { card: Card; revealed: boolean }) {
  return <p className="text-sm text-muted">{card.back || "Image card"}</p>;
}

/** Placeholder until the occlusion editor lands. */
export function OcclusionButtonSlot(_props: { spaceId: string }) {
  return null;
}
