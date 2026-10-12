import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useAskStatus } from "../../lib/queries";
import { s } from "../../lib/strings";
import { shortcutFromEvent, splitShortcut, validateShortcut } from "../../lib/capture/shortcut";
import { Button } from "../../components/ui/button";
import { ErrorState, Kbd, Skeleton, Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { Callout, SettingsGroup, SettingsRow } from "./layout";

export const ASK_DEFAULT_SHORTCUT = "Alt+CommandOrControl+A";
export const SNIP_DEFAULT_SHORTCUT = "Alt+CommandOrControl+S";

type Which = "ask" | "snip";

export function AskSection() {
  const { data, isLoading, error, refetch } = useAskStatus();
  const qc = useQueryClient();
  const [recording, setRecording] = useState<Which | null>(null);
  const [busy, setBusy] = useState(false);

  const configure = async (next: { enabled: boolean; shortcut: string; snipEnabled: boolean; snipShortcut: string }) => {
    setBusy(true);
    try {
      qc.setQueryData(qk.ask, await api.askConfigure(next.enabled, next.shortcut, next.snipEnabled, next.snipShortcut));
    } catch (e) {
      toastError(s.ask.registerFailed, e);
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
        setRecording(null);
        return;
      }
      const accel = shortcutFromEvent(e);
      if (!accel || validateShortcut(accel)) return;
      setRecording(null);
      void configure({
        enabled: data.enabled,
        shortcut: recording === "ask" ? accel : data.shortcut,
        snipEnabled: data.snipEnabled,
        snipShortcut: recording === "snip" ? accel : data.snipShortcut,
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, data]);

  if (isLoading) return <Skeleton className="h-20" />;
  if (error || !data) return <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />;

  const problem = (data.enabled && !data.registered && data.error) || (data.snipEnabled && !data.snipRegistered && data.snipError);
  const row = (which: Which) => {
    const ask = which === "ask";
    const shortcut = ask ? data.shortcut : data.snipShortcut;
    const enabled = ask ? data.enabled : data.snipEnabled;
    const fallback = ask ? ASK_DEFAULT_SHORTCUT : SNIP_DEFAULT_SHORTCUT;
    const apply = (patch: { enabled?: boolean; shortcut?: string }) =>
      configure({
        enabled: ask ? (patch.enabled ?? data.enabled) : data.enabled,
        shortcut: ask ? (patch.shortcut ?? data.shortcut) : data.shortcut,
        snipEnabled: ask ? data.snipEnabled : (patch.enabled ?? data.snipEnabled),
        snipShortcut: ask ? data.snipShortcut : (patch.shortcut ?? data.snipShortcut),
      });
    return (
      <SettingsRow title={ask ? s.ask.askRow : s.ask.snipRow} description={ask ? s.ask.askRowHint : s.ask.snipRowHint}>
        <span className="flex items-center gap-2">
          <Kbd aria-live="polite" data-testid={`${which}-shortcut`} keys={recording === which ? undefined : splitShortcut(shortcut)}>
            {recording === which ? s.capture.recording : null}
          </Kbd>
          {shortcut !== fallback && recording !== which && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply({ shortcut: fallback })}>
              {s.capture.reset}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRecording((r) => (r === which ? null : which))}>
            {recording === which ? s.common.cancel : s.capture.change}
          </Button>
          <Switch label={ask ? s.ask.askSwitch : s.ask.snipSwitch} checked={enabled} disabled={busy} onCheckedChange={(on) => apply({ enabled: on })} />
        </span>
      </SettingsRow>
    );
  };

  return (
    <>
      <SettingsGroup data-testid="ask-settings">
        {row("ask")}
        {row("snip")}
      </SettingsGroup>
      {problem && (
        <div className="mt-3">
          <Callout title={s.ask.notRegistered}>{problem}</Callout>
        </div>
      )}
    </>
  );
}
