import { useEffect } from "react";
import { useUi } from "../stores/ui";
import { useFocusStore } from "../features/focus/focusStore";

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const ui = useUi.getState();
      // while a break overlay is up, the overlay owns the keyboard
      if (useFocusStore.getState().breakLocked) return;
      if (e.key.toLowerCase() === "k" && !e.shiftKey) {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
      } else if (e.key.toLowerCase() === "f" && e.shiftKey) {
        e.preventDefault();
        ui.setFocusDialogOpen(true);
      } else if (e.key === ",") {
        e.preventDefault();
        ui.navigate({ name: "settings" });
      } else if (e.shiftKey && ui.route.name === "space" && (e.key.toLowerCase() === "s" || e.key.toLowerCase() === "t")) {
        e.preventDefault();
        ui.togglePane(e.key.toLowerCase() === "s" ? "sources" : "studio");
      } else if (e.key === "\\") {
        e.preventDefault();
        ui.toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
