import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk, useCaptureStatus } from "../../lib/queries";
import { s } from "../../lib/strings";
import { DEFAULT_SHORTCUT, formatShortcut, shortcutFromEvent, validateShortcut } from "../../lib/capture/shortcut";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";

export function CaptureSection() {
  const { data, isLoading, error, refetch } = useCaptureStatus();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  const configure = async (enabled: boolean, shortcut: string) => {
    setBusy(true);
    try {
      qc.setQueryData(qk.capture, await api.captureConfigure(enabled, shortcut));
    } catch (e) {
      toastError(s.capture.registerFailed, e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!recording || !data) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const accel = shortcutFromEvent(e);
      // modifier-only and Shift-only presses keep recording
      if (!accel || validateShortcut(accel)) return;
      setRecording(false);
      void configure(data.enabled, accel);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, data]);

  if (isLoading) return <Skeleton className="h-20" />;
  if (error || !data) return <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />;

  return (
    <div data-testid="capture-settings">
      <div className="flex items-center justify-between gap-6 py-2.5">
        <span className="text-sm">{s.capture.enable}</span>
        <Switch
          label={s.capture.enable}
          checked={data.enabled}
          disabled={busy}
          onCheckedChange={(on) => configure(on, data.shortcut)}
        />
      </div>
      <div className="flex items-center justify-between gap-6 py-2.5">
        <span className="text-sm">{s.capture.shortcut}</span>
        <div className="flex items-center gap-2">
          <kbd
            aria-live="polite"
            data-testid="capture-shortcut"
            className="min-w-16 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-center font-sans text-sm"
          >
            {recording ? s.capture.recording : formatShortcut(data.shortcut)}
          </kbd>
          {data.shortcut !== DEFAULT_SHORTCUT && !recording && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => configure(data.enabled, DEFAULT_SHORTCUT)}>
              {s.capture.reset}
            </Button>
          )}
          <Button size="sm" disabled={busy} onClick={() => setRecording((r) => !r)}>
            {recording ? s.common.cancel : s.capture.change}
          </Button>
        </div>
      </div>
      {data.enabled && !data.registered && data.error && (
        <div role="alert" className="mt-2 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-danger">{s.capture.notRegistered}</p>
            <p className="mt-0.5 break-words text-muted">{data.error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
