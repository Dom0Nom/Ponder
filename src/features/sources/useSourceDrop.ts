import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { isNativeApp } from "../../lib/utils";
import { fileImporter } from "../../lib/importers/files";
import { toastError } from "../../components/ui/toast";
import { useUi } from "../../stores/ui";

export function useSourceDrop(spaceId: string) {
  const [dragging, setDragging] = useState(false);
  const qc = useQueryClient();
  const setSourcesOpen = useUi((st) => st.setSourcesOpen);

  useEffect(() => {
    if (!isNativeApp()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(async (e) => {
        if (e.payload.type === "over" || e.payload.type === "enter") {
          setDragging(true);
          setSourcesOpen(spaceId, true);
        } else if (e.payload.type === "leave") setDragging(false);
        else if (e.payload.type === "drop") {
          setDragging(false);
          for (const path of e.payload.paths) {
            if (!fileImporter.canHandle(path)) {
              toastError(s.sources.importFailed, new Error(s.failures.unsupportedFile(path.split("/").pop() ?? path)));
              continue;
            }
            try {
              await fileImporter.import(spaceId, path);
            } catch (err) {
              toastError(s.sources.importFailed, err);
            }
          }
          qc.invalidateQueries({ queryKey: qk.sources(spaceId) });
        }
      })
      .then((f) => (unlisten = f))
      .catch(() => {});
    return () => unlisten?.();
  }, [spaceId, qc, setSourcesOpen]);

  return dragging;
}
