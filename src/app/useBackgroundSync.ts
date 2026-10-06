import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { events } from "../lib/ipc";
import { qk } from "../lib/queries";
import type { Source } from "../lib/types";
import { useUi } from "../stores/ui";

/** Keeps query caches in sync with backend events. */
export function useBackgroundSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const unsubs = [
      events.sourceUpdated((src) => {
        qc.setQueryData<Source[]>(qk.sources(src.spaceId), (old) =>
          old ? (old.some((x) => x.id === src.id) ? old.map((x) => (x.id === src.id ? src : x)) : [src, ...old]) : old,
        );
        if (src.status !== "processing") {
          qc.invalidateQueries({ queryKey: qk.spaces });
          qc.invalidateQueries({ queryKey: qk.coverage(src.spaceId) });
        }
      }),
      events.focusRequest(() => useUi.getState().setFocusDialogOpen(true)),
    ];
    return () => {
      unsubs.forEach((p) => p.then((f) => f()).catch(() => {}));
    };
  }, [qc]);
}
