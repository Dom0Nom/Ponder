import { create } from "zustand";
import { NoModelError } from "../lib/chat/llm";
import { api } from "../lib/ipc";
import { proxyHttp } from "../lib/importers/http";
import { resolveResearch, resolveSearchConfig } from "../lib/research/config";
import { deepResearch, type FoundSource, type ResearchStage } from "../lib/research/deepResearch";
import { s } from "../lib/strings";
import type { Space } from "../lib/types";
import { toast, toastError } from "../components/ui/toast";
import { useUi } from "./ui";

export interface ResearchRun {
  status: "running" | "done";
  query: string;
  stage: ResearchStage | null;
  detail: string;
  round: number;
  results: FoundSource[] | null;
  controller: AbortController;
}

interface ResearchStore {
  /** one run per space; it keeps going when the Add a source dialog closes */
  runs: Record<string, ResearchRun>;
  start: (space: Space, query: string) => Promise<void>;
  cancel: (spaceId: string) => void;
  clear: (spaceId: string) => void;
}

export const useResearch = create<ResearchStore>()((set, get) => {
  const patch = (spaceId: string, ctrl: AbortController, p: Partial<ResearchRun>) =>
    set((st) => {
      const cur = st.runs[spaceId];
      return cur && cur.controller === ctrl ? { runs: { ...st.runs, [spaceId]: { ...cur, ...p } } } : st;
    });
  const drop = (spaceId: string, ctrl: AbortController) =>
    set((st) => {
      if (st.runs[spaceId]?.controller !== ctrl) return st;
      const { [spaceId]: _gone, ...rest } = st.runs;
      return { runs: rest };
    });

  return {
    runs: {},
    start: async (space, query) => {
      if (get().runs[space.id]?.status === "running") return;
      const ctrl = new AbortController();
      set((st) => ({
        runs: { ...st.runs, [space.id]: { status: "running", query, stage: "planning", detail: "", round: 1, results: null, controller: ctrl } },
      }));
      try {
        const [{ llm, systemPrompt }, settings, sources] = await Promise.all([resolveResearch(space), api.getSettings(), api.listSources(space.id)]);
        const search = await resolveSearchConfig(settings, llm, ctrl.signal);
        const results = await deepResearch(query, {
          llm,
          systemPrompt,
          http: proxyHttp,
          signal: ctrl.signal,
          search,
          skipUrls: sources.map((x) => x.origin).filter((o): o is string => !!o),
          onStage: (stage, detail, round) => patch(space.id, ctrl, { stage, detail: detail ?? "", ...(round ? { round } : {}) }),
        });
        if (ctrl.signal.aborted) return;
        patch(space.id, ctrl, { status: "done", stage: null, detail: "", results });
        if (!useUi.getState().importDialog.open) {
          if (!results.length) toast(s.research.foundNone);
          else
            toast.success(s.research.foundToast(results.length), {
              duration: 15000,
              action: {
                label: s.research.review,
                onClick: () => {
                  const ui = useUi.getState();
                  ui.navigate({ name: "space", spaceId: space.id });
                  ui.setImportDialog({ open: true, tab: "research", query });
                },
              },
            });
        }
      } catch (e) {
        drop(space.id, ctrl);
        if (ctrl.signal.aborted) return;
        if (e instanceof NoModelError) toastError(s.research.needModel, null);
        else toastError(s.research.failed, e, () => void get().start(space, query));
      }
    },
    cancel: (spaceId) => {
      get().runs[spaceId]?.controller.abort();
      get().clear(spaceId);
    },
    clear: (spaceId) =>
      set((st) => {
        const { [spaceId]: _gone, ...rest } = st.runs;
        return { runs: rest };
      }),
  };
});
