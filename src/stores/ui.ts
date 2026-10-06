import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Route = { name: "home" } | { name: "space"; spaceId: string } | { name: "settings"; section?: string };
export type ThemePref = "system" | "light" | "dark";
export type FontPref = "inter" | "dyslexic";

interface UiState {
  route: Route;
  theme: ThemePref;
  font: FontPref;
  textScale: number;
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
    (set) => ({
      route: { name: "home" },
      theme: "system",
      font: "inter",
      textScale: 1,
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
      navigate: (route) => set({ route, viewer: null }),
      setTheme: (theme) => set({ theme }),
      setFont: (font) => set({ font }),
      setTextScale: (textScale) => set({ textScale }),
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
      partialize: (st) => ({
        route: st.route,
        theme: st.theme,
        font: st.font,
        textScale: st.textScale,
        panes: st.panes,
        activeThread: st.activeThread,
        thinking: st.thinking,
      }),
    },
  ),
);
