import { create } from "zustand";
import { MIXED_KEY } from "../../lib/practice/mix";
import type { Block } from "../../lib/session/engine";
import { useUi, type Route } from "../../stores/ui";
import { buildNext } from "./build";
import { toastError } from "../../components/ui/toast";
import { s } from "../../lib/strings";

interface SessionState {
  active: { spaceId: string; blocks: Block[]; index: number; done: string[] } | null;
  finished: number | null;
  start: (spaceId: string, blocks: Block[]) => void;
  complete: () => void;
  skip: () => void;
  end: () => void;
}

export function routeFor(block: Block, spaceId: string): Route | null {
  switch (block.kind) {
    case "review":
      return { name: "review", spaceId, tab: "cards" };
    case "retest":
    case "check":
    case "project":
      return { name: "practice", spaceId, topicKey: block.topic!.key, topicTitle: block.topic!.title };
    case "practice":
      return { name: "practice", spaceId, topicKey: MIXED_KEY, topicTitle: s.session.mixedTitle };
    case "new":
      return { name: "space", spaceId };
    default:
      return null;
  }
}

function open(spaceId: string, block: Block | undefined) {
  const r = block && routeFor(block, spaceId);
  if (r) useUi.getState().navigate(r);
}

export const useSession = create<SessionState>((set, get) => ({
  active: null,
  finished: null,
  start: (spaceId, blocks) => {
    set({ active: { spaceId, blocks, index: 0, done: [] }, finished: null });
    open(spaceId, blocks[0]);
  },
  complete: () => {
    const a = get().active;
    if (!a) return;
    const done = [...a.done, a.blocks[a.index].id];
    const index = a.index + 1;
    if (index >= a.blocks.length) return set({ active: null, finished: done.length });
    set({ active: { ...a, index, done } });
    open(a.spaceId, a.blocks[index]);
  },
  skip: () => {
    const a = get().active;
    if (!a) return;
    const index = a.index + 1;
    if (index >= a.blocks.length) return set({ active: null, finished: a.done.length });
    set({ active: { ...a, index } });
    open(a.spaceId, a.blocks[index]);
  },
  end: () => set({ active: null, finished: null }),
}));

/** Builds the list for a space and starts running it. */
export async function startNext(spaceId: string) {
  try {
    const built = await buildNext(spaceId);
    useSession.getState().start(spaceId, built.blocks);
  } catch (e) {
    toastError(s.session.loadFailed, e, () => startNext(spaceId));
  }
}
