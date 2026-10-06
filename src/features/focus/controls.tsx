import { useQueryClient } from "@tanstack/react-query";
import { Check, Coffee, Pause, Play, Square } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import type { FocusState, ParkingItem } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useFocusStore } from "./focusStore";

type Action = "pause" | "resume" | "endWork" | "stop";

/** Timer commands with pending state; results go straight into the focus store. */
export function useFocusActions() {
  const setState = useFocusStore((st) => st.setState);
  const qc = useQueryClient();
  const [pending, setPending] = useState<Action | null>(null);

  const run = async (action: Action) => {
    setPending(action);
    try {
      if (action === "stop") {
        await api.focusStop();
        setState(null);
        toast.success(s.focus.sessionEnded);
        qc.invalidateQueries({ queryKey: ["focusHistory"] });
      } else {
        const fn = { pause: api.focusPause, resume: api.focusResume, endWork: api.focusEndWork }[action];
        setState(await fn());
      }
    } catch (e) {
      toastError(s.focus.actionFailed, e, () => run(action));
    } finally {
      setPending(null);
    }
  };
  return { run, pending };
}

export function SessionControls({ state, size = "sm" }: { state: FocusState; size?: "sm" | "md" }) {
  const { run, pending } = useFocusActions();
  const isWork = state.phase === "work";
  const canTakeBreak = isWork && (state.technique === "flowtime" || state.technique === "timebox");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isWork &&
        (state.paused ? (
          <Button variant="primary" size={size} disabled={!!pending} onClick={() => run("resume")}>
            <Play size={15} /> {s.focus.resume}
          </Button>
        ) : (
          <Button variant="tonal" size={size} disabled={!!pending} onClick={() => run("pause")}>
            <Pause size={15} /> {s.focus.pause}
          </Button>
        ))}
      {!isWork && state.pauseReason === "needApp" && (
        <Button variant="primary" size={size} disabled={!!pending} onClick={() => run("resume")}>
          <Coffee size={15} /> {s.focus.resumeBreak}
        </Button>
      )}
      {canTakeBreak && (
        <Button variant="secondary" size={size} disabled={!!pending} onClick={() => run("endWork")}>
          <Coffee size={15} /> {s.focus.takeBreak}
        </Button>
      )}
      <Button variant="ghost" size={size} disabled={!!pending} onClick={() => run("stop")}>
        <Square size={13} /> {s.focus.end}
      </Button>
    </div>
  );
}

/** One-line capture; Enter parks the thought, Esc calls `onClose`. */
export function ParkingInput({
  onSaved,
  onClose,
  autoFocus,
  className,
}: {
  onSaved?: (item: ParkingItem) => void;
  onClose?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      const item = await api.parkingAdd(value);
      setText("");
      qc.invalidateQueries({ queryKey: ["parking"] });
      onSaved?.(item);
    } catch (e) {
      toastError(s.focus.parkingFailed, e);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape" && onClose) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <Input
      aria-label={s.focus.parking}
      placeholder={s.focus.parkingPlaceholder}
      value={text}
      autoFocus={autoFocus}
      disabled={saving}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      className={cn("h-9", className)}
    />
  );
}

export function ParkingList({ items, compact }: { items: ParkingItem[]; compact?: boolean }) {
  const qc = useQueryClient();
  const resolve = async (id: string) => {
    try {
      await api.parkingResolve(id);
      qc.invalidateQueries({ queryKey: ["parking"] });
    } catch (e) {
      toastError(s.focus.actionFailed, e);
    }
  };
  return (
    <ul className={cn("space-y-1", compact && "text-[0.8125rem]")}>
      {items.map((p) => (
        <li key={p.id} className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
          <button
            aria-label={s.focus.parkingResolve}
            title={s.focus.parkingResolve}
            onClick={() => resolve(p.id)}
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-transparent hover:border-accent hover:text-accent"
          >
            <Check size={10} strokeWidth={3} />
          </button>
          <span className="min-w-0 flex-1 break-words">{p.text}</span>
        </li>
      ))}
    </ul>
  );
}
