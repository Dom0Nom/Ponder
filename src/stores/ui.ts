import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProviderType } from "../lib/types";

export type Route =
  | { name: "home" }
  | { name: "space"; spaceId: string }
  | { name: "settings"; section?: string; page?: SettingsPage }
  | { name: "review"; spaceId?: string; tab?: "cards" | "mistakes" }
  | { name: "practice"; spaceId: string; topicKey?: string; topicTitle?: string };
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
  | "calculator";
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
  spaceDialogOpen: boolean;
  renamingThreadId: string | null;
  justAddedProvider: string | null;
  /** Studio sub-view; null is the main Studio view. Not persisted. */
  studioView: StudioView | null;
  panes: { sources: boolean; studio: boolean };
  paletteOpen: boolean;
  focusDialogOpen: boolean;
  captureOpen: boolean;
  watchDialogOpen: boolean;
  importDialog: { open: boolean; tab?: string; query?: string };
  /** active thread per space */
  activeThread: Record<string, string>;
  /** source viewer target */
  viewer: { sourceId: string; start?: number; end?: number } | null;
  /** model "thinking" in chat; off by default because local reasoning models get slow */
  thinking: boolean;
  setThinking: (t: boolean) => void;
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
  setStudioView: (v: StudioView | null) => void;
  togglePane: (p: "sources" | "studio") => void;
  setPaletteOpen: (o: boolean) => void;
  setFocusDialogOpen: (o: boolean) => void;
  setCaptureOpen: (o: boolean) => void;
  setWatchDialogOpen: (o: boolean) => void;
  setImportDialog: (d: { open: boolean; tab?: string; query?: string }) => void;
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
      spaceDialogOpen: false,
      renamingThreadId: null,
      justAddedProvider: null,
      studioView: null,
      panes: { sources: true, studio: true },
      paletteOpen: false,
      focusDialogOpen: false,
      captureOpen: false,
      watchDialogOpen: false,
      importDialog: { open: false },
      activeThread: {},
      viewer: null,
      thinking: false,
      setThinking: (thinking) => set({ thinking }),
      navigate: (route) =>
        set((st) => ({
          route,
          viewer: null,
          studioView:
            route.name === "space" && st.route.name === "space" && route.spaceId === st.route.spaceId ? st.studioView : null,
          settingsReturn: route.name === "settings" && st.route.name !== "settings" ? st.route : st.settingsReturn,
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
      setStudioView: (studioView) => set({ studioView }),
      togglePane: (p) => set((st) => ({ panes: { ...st.panes, [p]: !st.panes[p] } })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setFocusDialogOpen: (focusDialogOpen) => set({ focusDialogOpen }),
      setCaptureOpen: (captureOpen) => set({ captureOpen }),
      setWatchDialogOpen: (watchDialogOpen) => set({ watchDialogOpen }),
      setImportDialog: (importDialog) => set({ importDialog }),
      setActiveThread: (spaceId, threadId) =>
        set((st) => ({ activeThread: { ...st.activeThread, [spaceId]: threadId } })),
      openViewer: (viewer) =>
        set((st) => ({ viewer, panes: viewer ? { ...st.panes, sources: true } : st.panes })),
    }),
    {
      name: "ui",
      version: 1,
      migrate: (st: unknown, v: number) => {
        const o = st as { font?: string };
        return (v < 1 && o?.font === "inter" ? { ...o, font: "default" } : st) as UiState;
      },
      partialize: (st) => ({
        route: st.route,
        theme: st.theme,
        font: st.font,
        textScale: st.textScale,
        reduceMotion: st.reduceMotion,
        visualEffects: st.visualEffects,
        sidebarOpen: st.sidebarOpen,
        panes: st.panes,
        activeThread: st.activeThread,
        thinking: st.thinking,
      }),
    },
  ),
);
