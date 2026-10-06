import { useQuery } from "@tanstack/react-query";
import { Check, Coffee, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { useFocusPrefs } from "../../lib/focusPrefs";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { FocusState } from "../../lib/types";
import { ParkingList } from "./controls";
import { isBreakPhase, useFocusStore } from "./focusStore";
import { TimeBar } from "./TimeBar";
import { clockText } from "./timer";

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
      className="pointer-events-auto fixed inset-0 z-[2147483000] flex flex-col items-center overflow-y-auto bg-bg px-6 outline-none"
    >
      <div className="m-auto flex w-full max-w-xl flex-col items-center py-12 text-center">
        <p className="mb-8 flex items-center gap-2 text-sm font-medium text-muted">
          <Coffee size={16} /> {s.focus.block(state.block)}
        </p>
        <TimeBar state={state} size={300}>
          <span className="text-6xl font-semibold tabular-nums tracking-tight" aria-live="off">
            {clockText(state)}
          </span>
          <span className="mt-1 text-sm text-muted">{s.focus.left}</span>
        </TimeBar>
        <h1 id="break-title" className="mt-10 text-2xl font-semibold">
          {title}
        </h1>
        <p id="break-body" className="mt-2 max-w-md text-[0.9375rem] text-muted">
          {s.focus.breakBody}
        </p>
        {menu.length > 0 ? (
          <section aria-labelledby="break-pick" className="mt-8 w-full max-w-md text-left">
            <h2 id="break-pick" className="mb-3 text-center text-sm font-medium text-muted">
              {s.breakMenu.pick}
            </h2>
            <div className="flex flex-col gap-2">
              {menu.map((item) => {
                const on = picked === item;
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(item)}
                    className={cn(
                      "flex min-h-14 w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border-2 px-5 py-3 text-left text-base shadow-card transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      on ? "border-accent bg-accent-soft text-accent-text" : "border-transparent bg-surface hover:bg-surface-2",
                    )}
                  >
                    <span>{item}</span>
                    {on && <Check size={18} aria-hidden />}
                  </button>
                );
              })}
            </div>
            <p role="status" className="mt-3 min-h-5 text-center text-sm text-muted">
              {picked ? s.breakMenu.picked(picked) : ""}
            </p>
          </section>
        ) : (
        <div className="mt-8 flex w-full max-w-md items-start gap-3 rounded-[var(--radius-card)] bg-surface p-4 text-left shadow-card">
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-timer-break" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-faint">{s.focus.tipLabel}</p>
            <p className="mt-0.5 text-[0.9375rem]">{tip}</p>
          </div>
        </div>
        )}
        {parking.isError && <p className="mt-6 text-xs text-danger">{s.focus.parkingLoadFailed}</p>}
        {open.length > 0 && (
          <div className="mt-4 w-full max-w-md rounded-[var(--radius-card)] bg-surface p-4 text-left shadow-card">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{s.focus.parkingAtBreak}</p>
            <ParkingList items={open} />
          </div>
        )}
        <div className="mt-12 flex flex-col items-center gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={needApp} className="text-faint">
            {busy && <Spinner size={13} />}
            {s.focus.needApp}
          </Button>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PausedBanner({ state }: { state: FocusState }) {
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
      className="fixed left-1/2 top-2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface py-1 pl-4 pr-1 text-[0.8125rem] shadow-lg"
    >
      <Coffee size={15} className="text-timer-break" />
      <span className="font-medium">{s.focus.breakPaused}</span>
      <span className="text-faint tabular-nums">· {s.focus.timeLeft(clockText(state))}</span>
      <Button variant="primary" size="sm" disabled={busy} onClick={resume}>
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
  if (!state || !isBreakPhase(state)) return null;
  if (locked) return <LockedBreak state={state} />;
  return <PausedBanner state={state} />;
}
