import { ThreadList } from "../features/chat/ThreadList";

/** Mount point for the space screen's chat list (New chat divider + grouped threads). */
export function SidebarThreadListSlot({ spaceId }: { spaceId: string }) {
  return <ThreadList spaceId={spaceId} />;
}
