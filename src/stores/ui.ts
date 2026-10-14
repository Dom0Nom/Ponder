import type { FoundSource } from "../lib/research/deepResearch";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelControls } from "../lib/providers/controls";
import type { ProviderType } from "../lib/types";

export type Route =
  | { name: "home" }
  | { name: "space"; spaceId: string }
  | { name: "settings"; section?: string; page?: SettingsPage }
  | { name: "review"; spaceId?: string; tab?: "cards" | "mistakes" }
  | { name: "practice"; spaceId: string; topicKey?: string; topicTitle?: string }
  | { name: "insights"; spaceId?: string }
  | { name: "exam"; spaceId?: string; attemptId?: string }
  | { name: "output"; spaceId: string; outputId: string }
  | { name: "notes"; spaceId: string; noteId?: string };
export type SettingsPage =
  | { kind: "addProvider"; type?: ProviderType }
  | { kind: "lanScan" }
  | { kind: "grokSignIn"; providerId: string }
  | { kind: "breakMenu" };
export type StudioView =
  | "focus"
  | "microsteps"
  | "lowEnergy"
  | "journal"
  | "flashcards"
  | "steps"
  | "plan"
  | "course"
  | "settings"
  | "calculator"
  | "create"
  | "feynman"
  | "projects";
export type ThemePref = "system" | "light" | "dark";
export type FontPref = "default" | "dyslexic";

interface UiState {
  route: Route;
  theme: ThemePref;
  font: FontPref;
  textScale: number;
  reduceMotion: boolean;
  visualEffects: boolean;
  sidebarOpen: boolean;
  /** route Settings returns to */
  settingsReturn: Route;
  /** Where Practice/Review was opened from, for the header back button. */
  backRoute: Route | null;
  spaceDialogOpen: boolean;
  renamingThreadId: string | null;
  justAddedProvider: string | null;
  /** Studio sub-view; null is the main Studio view. Not persisted. */
  studioView: StudioView | null;
  /** view Back returns to from the current sub-view */
  studioFrom: StudioView | null;
  studioOpen: boolean;
  /** Sources panel per space; undefined is closed. Not persisted. */
  sourcesOpen: Record<string, boolean>;
  paletteOpen: boolean;
  focusDialogOpen: boolean;
  /** goal the next Focus start dialog opens with; consumed on open */
  focusGoalPreset: string | null;
  captureOpen: boolean;
  watchDialogOpen: boolean;
  importDialog: { open: boolean; tab?: string; query?: string; found?: FoundSource[]; url?: string; file?: string };
  /** active thread per space */
  activeThread: Record<string, string>;
  /** source viewer target */
  viewer: { sourceId: string; start?: number; end?: number } | null;
  /** reasoning/verbosity/temperature per `${providerId}:${model}` */
  modelControls: Record<string, ModelControls>;
  setModelControls: (key: string, patch: ModelControls) => void;
  /** most recently picked model ids per provider id, newest first */
  recentModels: Record<string, string[]>;
  pushRecentModel: (providerId: string, model: string) => void;
  navigate: (r: Route) => void;
  setTheme: (t: ThemePref) => void;
  setFont: (f: FontPref) => void;
  setTextScale: (n: number) => void;
  setReduceMotion: (v: boolean) => void;
  setVisualEffects: (v: boolean) => void;
  toggleSidebar: () => void;
  setSpaceDialogOpen: (o: boolean) => void;
  setRenamingThread: (id: string | null) => void;
  setJustAddedProvider: (id: string | null) => void;
  setStudioView: (v: StudioView | null, from?: StudioView | null) => void;
  toggleStudio: () => void;
  setSourcesOpen: (spaceId: string, open: boolean) => void;
  setPaletteOpen: (o: boolean) => void;
  setFocusDialogOpen: (o: boolean) => void;
  openFocusDialog: (goal?: string) => void;
  setCaptureOpen: (o: boolean) => void;
  setWatchDialogOpen: (o: boolean) => void;
  setImportDialog: (d: { open: boolean; tab?: string; query?: string; url?: string; file?: string }) => void;
  setActiveThread: (spaceId: string, threadId: string) => void;
  openViewer: (v: { sourceId: string; start?: number; end?: number } | null) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      route: { name: "home" },
      theme: "system",
      font: "default",
      textScale: 1,
      reduceMotion: false,
      visualEffects: true,
      sidebarOpen: true,
      settingsReturn: { name: "home" },
      backRoute: null,
      spaceDialogOpen: false,
      renamingThreadId: null,
      justAddedProvider: null,
      studioView: null,
      studioFrom: null,
      studioOpen: true,
      sourcesOpen: {},
      paletteOpen: false,
      focusDialogOpen: false,
      focusGoalPreset: null,
      captureOpen: false,
      watchDialogOpen: false,
      importDialog: { open: false },
      activeThread: {},
      viewer: null,
      modelControls: {},
      recentModels: {},
      pushRecentModel: (providerId, model) =>
        set((st) => ({
          recentModels: {
            ...st.recentModels,
            [providerId]: [model, ...(st.recentModels[providerId] ?? []).filter((m) => m !== model)].slice(0, 10),
          },
        })),
      setModelControls: (key, patch) =>
        set((st) => ({ modelControls: { ...st.modelControls, [key]: { ...st.modelControls[key], ...patch } } })),
      navigate: (route) =>
        set((st) => ({
          route,
          viewer: null,
          studioView:
            route.name === "space" && st.route.name === "space" && route.spaceId === st.route.spaceId ? st.studioView : null,
          studioFrom: route.name === "space" && st.route.name === "space" && route.spaceId === st.route.spaceId ? st.studioFrom : null,
          settingsReturn: route.name === "settings" && st.route.name !== "settings" ? st.route : st.settingsReturn,
          backRoute:
            route.name === "practice" || route.name === "review"
              ? st.route.name === route.name
                ? st.backRoute
                : st.route
              : null,
        })),
      setTheme: (theme) => set({ theme }),
      setFont: (font) => set({ font }),
      setTextScale: (textScale) => set({ textScale }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setVisualEffects: (visualEffects) => set({ visualEffects }),
      toggleSidebar: () => set((st) => ({ sidebarOpen: !st.sidebarOpen })),
      setSpaceDialogOpen: (spaceDialogOpen) => set({ spaceDialogOpen }),
      setRenamingThread: (id) => set({ renamingThreadId: id, sidebarOpen: id ? true : get().sidebarOpen }),
      setJustAddedProvider: (justAddedProvider) => set({ justAddedProvider }),
      setStudioView: (studioView, from = null) => set({ studioView, studioFrom: studioView ? from : null }),
      toggleStudio: () => set((st) => ({ studioOpen: !st.studioOpen })),
      setSourcesOpen: (spaceId, open) => set((st) => ({ sourcesOpen: { ...st.sourcesOpen, [spaceId]: open } })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setFocusDialogOpen: (focusDialogOpen) => set({ focusDialogOpen }),
      openFocusDialog: (goal) => set({ focusDialogOpen: true, focusGoalPreset: goal ?? null }),
      setCaptureOpen: (captureOpen) => set({ captureOpen }),
      setWatchDialogOpen: (watchDialogOpen) => set({ watchDialogOpen }),
      setImportDialog: (importDialog) => set({ importDialog }),
      setActiveThread: (spaceId, threadId) =>
        set((st) => ({ activeThread: { ...st.activeThread, [spaceId]: threadId } })),
      openViewer: (viewer) => set({ viewer }),
    }),
    {
      name: "ui",
      version: 3,
      migrate: (st: unknown, v: number) => {
        const o = { ...(st as { font?: string; panes?: unknown; thinking?: unknown; modelControls?: Record<string, Record<string, unknown>> }) };
        if (v < 3 && o.modelControls) {
          // controls used to store one generic `reasoning` level; keep what maps onto an effort, drop the rest
          o.modelControls = Object.fromEntries(
            Object.entries(o.modelControls).map(([k, c]) => {
              const { reasoning, ...rest } = c;
              const next: Record<string, unknown> = { ...rest };
              if (reasoning === "none") next.thinking = false;
              else if (typeof reasoning === "string") next.effort = reasoning;
              return [k, next];
            }),
          );
        }
        if (v < 1 && o.font === "inter") o.font = "default";
        if (v < 2) {
          delete o.panes;
          delete o.thinking;
        }
        return o as unknown as UiState;
      },
      partialize: (st) => ({
        route: st.route,
        theme: st.theme,
        font: st.font,
        textScale: st.textScale,
        reduceMotion: st.reduceMotion,
        visualEffects: st.visualEffects,
        sidebarOpen: st.sidebarOpen,
        studioOpen: st.studioOpen,
        activeThread: st.activeThread,
        modelControls: st.modelControls,
        recentModels: st.recentModels,
      }),
    },
  ),
);
