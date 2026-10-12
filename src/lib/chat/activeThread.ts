import type { Thread } from "../types";

/** The selected thread, or the most recently updated one when nothing valid is selected. */
export function pickActiveThread(threads: Thread[] | undefined, activeId: string | undefined): Thread | undefined {
  return threads?.find((t) => t.id === activeId) ?? threads?.reduce<Thread | undefined>((a, t) => (!a || t.updatedAt > a.updatedAt ? t : a), undefined);
}
