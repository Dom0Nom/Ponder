import { create } from "zustand";
import { api } from "../lib/ipc";
import { resolveChatModel } from "../lib/chat/llm";
import { queryClient } from "../lib/queries";
import { s } from "../lib/strings";
import { gatherMaterial, generateOutput, NoMaterialError } from "../lib/studio/generate";
import type { AudioStyle, OutputKind } from "../lib/studio/kinds";
import type { Space, StudioOutput } from "../lib/types";
import { toast } from "../components/ui/toast";
import { useUi } from "./ui";

export const qkOutputs = (spaceId: string) => ["outputs", spaceId] as const;
export const qkOutput = (id: string) => ["output", id] as const;

interface Job {
  kind: OutputKind;
  ctrl: AbortController;
}

interface OutputJobs {
  /** One running job per space; generation keeps going when the panel closes. */
  jobs: Record<string, Job>;
  errors: Record<string, unknown>;
  start: (space: Space, kind: OutputKind, focus: string, replaceId?: string, style?: AudioStyle) => Promise<StudioOutput | null>;
  cancel: (spaceId: string) => void;
  clearError: (spaceId: string) => void;
}

export const useOutputJobs = create<OutputJobs>((set, get) => ({
  jobs: {},
  errors: {},
  start: async (space, kind, focus, replaceId, style) => {
    get().jobs[space.id]?.ctrl.abort();
    const ctrl = new AbortController();
    set((st) => ({ jobs: { ...st.jobs, [space.id]: { kind, ctrl } }, errors: { ...st.errors, [space.id]: undefined } }));
    const done = () =>
      set((st) => {
        if (st.jobs[space.id]?.ctrl !== ctrl) return st;
        const jobs = { ...st.jobs };
        delete jobs[space.id];
        return { jobs };
      });
    try {
      const llm = await resolveChatModel(space);
      const material = await gatherMaterial(space.id, focus.trim(), llm);
      const out = await generateOutput(llm, kind, material, focus, ctrl.signal, style);
      if (ctrl.signal.aborted) return null;
      const prev = replaceId ? await api.outputGet(replaceId) : null;
      const saved = await api.outputSave({
        id: prev?.id ?? "",
        spaceId: space.id,
        kind,
        title: out.title,
        focus: focus.trim() || null,
        data: out.data,
        createdAt: prev?.createdAt ?? 0,
        updatedAt: 0,
      });
      queryClient.setQueryData(qkOutput(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: qkOutputs(space.id) });
      done();
      const ui = useUi.getState();
      const watching =
        (ui.route.name === "space" && ui.route.spaceId === space.id && ui.studioView === "create") ||
        (ui.route.name === "output" && ui.route.outputId === replaceId);
      if (watching) ui.navigate({ name: "output", spaceId: space.id, outputId: saved.id });
      else
        toast.success(saved.title, {
          description: s.outputs.kinds[kind].name,
          action: { label: s.common.open, onClick: () => useUi.getState().navigate({ name: "output", spaceId: space.id, outputId: saved.id }) },
        });
      return saved;
    } catch (e) {
      done();
      if (ctrl.signal.aborted) return null;
      set((st) => ({ errors: { ...st.errors, [space.id]: e instanceof NoMaterialError ? new Error(s.outputs.noMaterial) : e } }));
      return null;
    }
  },
  cancel: (spaceId) => {
    get().jobs[spaceId]?.ctrl.abort();
    set((st) => {
      const jobs = { ...st.jobs };
      delete jobs[spaceId];
      return { jobs };
    });
  },
  clearError: (spaceId) => set((st) => ({ errors: { ...st.errors, [spaceId]: undefined } })),
}));
