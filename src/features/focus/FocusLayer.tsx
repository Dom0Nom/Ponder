import { useQueryClient } from "@tanstack/react-query";
import { StickyNote } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { useStayMounted } from "../../components/motion/useStayMounted";
import { Kbd } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { events } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import { BreakOverlay } from "./BreakOverlay";
import { ParkingInput } from "./controls";
import { FocusStartDialog } from "./FocusStartDialog";
import { emitFocusTransition, loadFocusState, useFocusStore } from "./focusStore";

export { useFocusTransitions, onFocusTransition } from "./focusStore";

function ParkingCapture() {
  const open = useFocusStore((st) => st.parkingOpen);
  const setOpen = useFocusStore((st) => st.setParkingOpen);
  const active = useFocusStore((st) => !!st.state);
  const locked = useFocusStore((st) => st.breakLocked);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "p") return;
      const st = useFocusStore.getState();
      if (st.breakLocked || !st.state) return;
      e.preventDefault();
      st.setParkingOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!active || locked) setOpen(false);
  }, [active, locked, setOpen]);

  const mounted = useStayMounted(open, 250);
  if (!mounted) return null;
  return createPortal(
    <div
      role="dialog"
      aria-label={s.focus.parking}
      inert={!open}
      style={{ "--toast-distance": "-16px" } as CSSProperties}
      className={cn(
        "t-toast fixed left-1/2 top-16 z-[80] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-2xl",
        open && "is-open",
      )}
    >
      <p className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted">
        <span className="flex items-center gap-1.5">
          <StickyNote size={14} /> {s.focus.parking}
        </span>
        <Kbd>{s.focus.parkingShortcut}</Kbd>
      </p>
      <ParkingInput
        autoFocus
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          toast.success(s.focus.parkingSaved);
        }}
      />
    </div>,
    document.body,
  );
}

/** Mounts focus-session UI that floats above every screen: start dialog, parking capture and break overlay. */
export function FocusLayer() {
  const qc = useQueryClient();
  const locked = useFocusStore((st) => st.breakLocked);

  useEffect(() => {
    const load = () => loadFocusState().catch((e) => toastError(s.focus.loadFailed, e, load));
    load();
    const setState = useFocusStore.getState().setState;
    const unsubs = [
      events.focusTick((st) => setState(st)),
      events.focusTransition((t) => {
        setState(t.to === "done" ? null : t.state);
        emitFocusTransition(t);
        qc.invalidateQueries({ queryKey: ["focusHistory"] });
        qc.invalidateQueries({ queryKey: ["parking"] });
      }),
    ];
    return () => {
      unsubs.forEach((p) => p.then((f) => f()).catch(() => {}));
    };
  }, [qc]);

  // nothing else may sit above or trap focus away from the break screen
  useEffect(() => {
    if (!locked) return;
    const ui = useUi.getState();
    ui.setFocusDialogOpen(false);
    ui.setPaletteOpen(false);
    ui.setImportDialog({ open: false });
  }, [locked]);

  return (
    <>
      <FocusStartDialog />
      <ParkingCapture />
      <BreakOverlay />
    </>
  );
}
