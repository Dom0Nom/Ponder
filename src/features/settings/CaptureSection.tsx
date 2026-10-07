import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useCaptureStatus } from "../../lib/queries";
import { s } from "../../lib/strings";
import { DEFAULT_SHORTCUT, shortcutFromEvent, splitShortcut, validateShortcut } from "../../lib/capture/shortcut";
import { Button } from "../../components/ui/button";
import { ErrorState, Kbd, Skeleton, Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { Callout, SettingsGroup, SettingsRow } from "./layout";

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
    <>
      <SettingsGroup data-testid="capture-settings">
        <SettingsRow title={s.capture.enable}>
          <Switch
            label={s.capture.enable}
            checked={data.enabled}
            disabled={busy}
            onCheckedChange={(on) => configure(on, data.shortcut)}
          />
        </SettingsRow>
        <SettingsRow title={s.capture.shortcut}>
          <span className="flex items-center gap-2">
            <Kbd
              aria-live="polite"
              data-testid="capture-shortcut"
              keys={recording ? undefined : splitShortcut(data.shortcut)}
            >
              {recording ? s.capture.recording : null}
            </Kbd>
            {data.shortcut !== DEFAULT_SHORTCUT && !recording && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => configure(data.enabled, DEFAULT_SHORTCUT)}>
                {s.capture.reset}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRecording((r) => !r)}>
              {recording ? s.common.cancel : s.capture.change}
            </Button>
          </span>
        </SettingsRow>
      </SettingsGroup>
      {data.enabled && !data.registered && data.error && (
        <div className="mt-3">
          <Callout title={s.capture.notRegistered}>{data.error}</Callout>
        </div>
      )}
    </>
  );
}
