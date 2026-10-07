import { useQuery } from "@tanstack/react-query";
import { Coffee } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { useFocusPrefs } from "../../lib/focusPrefs";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { FocusState } from "../../lib/types";
import { ParkingList } from "./controls";
import { isBreakPhase, useFocusStore } from "./focusStore";
import { clockText, popKeyOf } from "./timer";
import { NumberPop } from "../../components/motion/NumberPop";
import { useStayMounted } from "../../components/motion/useStayMounted";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TIP_EVERY_MS = 45_000;

/** Swallows every key outside the overlay's own controls and keeps Tab inside it. */
function useKeyboardLock(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      const inside = root.contains(e.target as Node);
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return root.focus();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
        items[next].focus();
        return;
      }
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (inside && plain && (e.key === "Enter" || e.key === " ") && e.target !== root) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onFocusIn = (e: FocusEvent) => {
      const root = ref.current;
      if (root && !root.contains(e.target as Node)) root.focus();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
    ref.current?.focus();
    const appRoot = document.getElementById("root");
    if (appRoot) appRoot.inert = true;
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn, true);
      if (appRoot) appRoot.inert = false;
    };
  }, [ref]);
}

function LockedBreak({ state }: { state: FocusState }) {
  const ref = useRef<HTMLDivElement>(null);
  const setState = useFocusStore((st) => st.setState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const { prefs } = useFocusPrefs();
  const menu = prefs.breakMenu;
  useKeyboardLock(ref);

  const parking = useQuery({
    queryKey: qk.parking(state.sessionId),
    queryFn: () => api.parkingList(state.sessionId),
  });
  const open = parking.data?.filter((p) => !p.resolved) ?? [];

  const tips = s.focus.breakTips;
  const tip = tips[(Math.floor(state.elapsedMs / TIP_EVERY_MS) + state.block) % tips.length];
  const title = state.phase === "longBreak" ? s.focus.longBreakTitle : s.focus.breakTitle;

  const needApp = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await api.focusNeedApp());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="break-title"
      aria-describedby="break-body"
      tabIndex={-1}
      className="m-break pointer-events-auto fixed inset-0 z-[2147483000] grid grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] justify-items-center bg-chrome px-6 outline-none"
    >
      <div />
      <div className="flex flex-col items-center text-center">
        <p className="mt-3.5 text-timer-xl font-medium tabular-nums" aria-live="off">
          <NumberPop text={clockText(state)} popKey={popKeyOf(state)} onMount />
        </p>
        <h1 id="break-title" className="mt-9 text-[1.5rem] font-semibold">
          {title}
        </h1>
        <p id="break-body" className="sr-only">
          {s.focus.breakBody}
        </p>
      </div>
      <div className="flex min-h-0 w-full flex-col items-center overflow-y-auto pb-24 pt-8">
        {menu.length > 0 ? (
          <section aria-labelledby="break-pick" className="w-full max-w-[520px]">
            <h2 id="break-pick" className="mb-2 text-center text-label font-semibold text-muted">
              {s.breakMenu.pick}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {menu.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={picked === item}
                  onClick={() => setPicked(item)}
                  className="flex h-10 items-center justify-between gap-3 rounded-pane border border-border bg-surface px-3.5 text-left text-input font-medium transition-colors hover:bg-fill aria-pressed:bg-fill-active aria-pressed:font-semibold"
                >
                  <span>{item}</span>
                </button>
              ))}
            </div>
            <p role="status" className="mt-3 min-h-5 text-center text-body text-muted">
              {picked ? s.breakMenu.picked(picked) : ""}
            </p>
          </section>
        ) : (
          <div className="max-w-md text-center">
            <p className="text-label font-semibold text-muted">{s.focus.tipLabel}</p>
            <p className="mt-0.5 text-title-sm text-fg-secondary">{tip}</p>
          </div>
        )}
        {parking.isError && <p className="mt-6 text-label text-danger">{s.focus.parkingLoadFailed}</p>}
        {open.length > 0 && (
          <div className="mt-6 w-full max-w-md text-left">
            <p className="mb-2 text-label font-semibold text-muted">{s.focus.parkingAtBreak}</p>
            <ParkingList items={open} />
          </div>
        )}
      </div>
      <div className="fixed bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        {error && (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        )}
        <Button variant="ghost-muted" size="sm" disabled={busy} onClick={needApp}>
          {busy && <Spinner size={13} />}
          {s.focus.needApp}
        </Button>
      </div>
    </div>,
    document.body,
  );
}

function PausedBanner({ state, open }: { state: FocusState; open: boolean }) {
  const setState = useFocusStore((st) => st.setState);
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      setState(await api.focusResume());
    } catch (e) {
      toastError(s.focus.actionFailed, e, resume);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div
      role="status"
      inert={!open}
      style={{ "--toast-distance": "-16px" } as CSSProperties}
      className={cn(
        "t-toast fixed left-1/2 top-2 z-[70] flex h-10 -translate-x-1/2 items-center gap-3 rounded-pane border border-border bg-surface pl-3.5 pr-1 text-body shadow-menu",
        open && "is-open",
      )}
    >
      <Coffee size={15} />
      <span className="font-medium">{s.focus.breakPaused}</span>
      <span className="text-muted tabular-nums">· {s.focus.timeLeft(clockText(state))}</span>
      <Button variant="primary" size="sm" className="h-8 px-3" disabled={busy} onClick={resume}>
        {s.focus.resumeBreak}
      </Button>
    </div>,
    document.body,
  );
}

/** Blocking break screen rendered from backend state, so it survives reloads; "I need the app" is the only way out. */
export function BreakOverlay() {
  const state = useFocusStore((st) => st.state);
  const locked = useFocusStore((st) => st.breakLocked);
  const onBreak = !!state && isBreakPhase(state);
  const banner = onBreak && !locked;
  const mounted = useStayMounted(banner, 250);
  const last = useRef(state);
  if (state && isBreakPhase(state)) last.current = state;
  if (onBreak && locked) return <LockedBreak state={state} />;
  if (!mounted || !last.current) return null;
  return <PausedBanner state={last.current} open={banner} />;
}
