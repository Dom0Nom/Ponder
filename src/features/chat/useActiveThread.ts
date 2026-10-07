import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useThreads } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Thread } from "../../lib/types";
import { toastError } from "../../components/ui/toast";
import { useUi } from "../../stores/ui";

/** The selected chat of a space; the newest one until the learner picks another. */
export function useActiveThread(spaceId: string): Thread | undefined {
  const threads = useThreads(spaceId);
  const activeId = useUi((st) => st.activeThread[spaceId]);
  const list = threads.data;
  return list?.find((t) => t.id === activeId) ?? list?.reduce<Thread | undefined>((a, t) => (!a || t.updatedAt > a.updatedAt ? t : a), undefined);
}

export function useNewThread(spaceId: string) {
  const qc = useQueryClient();
  const setActive = useUi((st) => st.setActiveThread);
  const create = async (): Promise<Thread> => {
    try {
      const t = await api.createThread(spaceId);
      qc.invalidateQueries({ queryKey: qk.threads(spaceId) });
      setActive(spaceId, t.id);
      return t;
    } catch (e) {
      toastError(s.errors.generic, e, create);
      throw e;
    }
  };
  return create;
}
