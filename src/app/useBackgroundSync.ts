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
      events.watchUpdated(({ spaceId }) => {
        qc.invalidateQueries({ queryKey: qk.watched(spaceId) });
      }),
      events.captureOpen(() => useUi.getState().setCaptureOpen(true)),
      events.captureStatus((st) => qc.setQueryData(qk.capture, st)),
      events.askStatus((st) => qc.setQueryData(qk.ask, st)),
      events.askNavigate((r) => {
        const ui = useUi.getState();
        qc.invalidateQueries({ queryKey: qk.threads(r.spaceId) });
        qc.invalidateQueries({ queryKey: qk.messages(r.threadId) });
        ui.setActiveThread(r.spaceId, r.threadId);
        ui.navigate({ name: "space", spaceId: r.spaceId });
        if (r.sourceId) ui.openViewer({ sourceId: r.sourceId, start: r.start ?? undefined, end: r.end ?? undefined });
      }),
    ];
    return () => {
      unsubs.forEach((p) => p.then((f) => f()).catch(() => {}));
    };
  }, [qc]);
}
