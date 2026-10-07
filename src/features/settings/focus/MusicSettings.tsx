import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, events } from "../../../lib/ipc";
import { qk, useMusicStatus } from "../../../lib/queries";
import { useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { parsePlaylistUri } from "../../../lib/music";
import { s } from "../../../lib/strings";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { ErrorState, Skeleton, Spinner, Switch } from "../../../components/ui/misc";
import { toast, toastError } from "../../../components/ui/toast";
import { Callout, SettingsRow } from "../layout";

export function MusicSettings() {
  const status = useMusicStatus();
  const { prefs, isLoading, error: prefsError } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const un = events.musicError(() => qc.invalidateQueries({ queryKey: qk.music }));
    return () => {
      void un.then((f) => f());
    };
  }, [qc]);

  if (status.data && !status.data.available) return null;
  if (status.isLoading || isLoading) return <Skeleton className="my-3 h-12" />;
  if (status.error || !status.data) {
    return <ErrorState title={s.errors.generic} error={status.error} onRetry={() => status.refetch()} />;
  }
  if (prefsError) return <ErrorState title={s.errors.generic} error={prefsError} />;

  const { enabled, playlist } = prefs.music;
  const value = draft ?? playlist;
  const parsed = parsePlaylistUri(value);
  const invalid = value.trim() !== "" && !parsed.ok ? parsed.error : null;

  const save = async (next: { enabled: boolean; playlist: string }) => {
    try {
      await setPref("music", next);
    } catch (e) {
      toastError(s.music.saveFailed, e);
    }
  };

  const commit = async () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === playlist) return setDraft(null);
    if (trimmed === "" || parsed.ok) {
      await save({ enabled, playlist: trimmed });
      setDraft(null);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await api.musicTest(value);
      toast.success(s.music.testStarted);
    } catch (e) {
      toastError(s.music.testFailed, e);
    } finally {
      setTesting(false);
      void qc.invalidateQueries({ queryKey: qk.music });
    }
  };

  return (
    <div data-testid="music-settings" className="[&>*+*]:border-t [&>*+*]:border-divider">
      <SettingsRow title={s.music.enable} description={s.music.body}>
        <Switch label={s.music.enable} checked={enabled} onCheckedChange={(on) => save({ enabled: on, playlist })} />
      </SettingsRow>
      {enabled && (
        <div className="flex flex-col gap-2 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Input
                aria-label={s.music.playlist}
                aria-invalid={invalid ? true : undefined}
                placeholder={s.music.placeholder}
                value={value}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void commit()}
                onKeyDown={(e) => e.key === "Enter" && void commit()}
              />
              {invalid && (
                <p role="alert" className="mt-1.5 text-body text-danger">
                  {invalid}
                </p>
              )}
            </div>
            <Button variant="secondary" size="md" disabled={!parsed.ok || testing} onClick={() => void test()}>
              {testing ? <Spinner /> : null}
              {testing ? s.music.testing : s.music.test}
            </Button>
          </div>
          <p className="text-caption text-muted">{s.music.permissionHint}</p>
        </div>
      )}
      {status.data.lastError && (
        <div className="py-3">
          <Callout title={s.music.lastError}>{status.data.lastError}</Callout>
        </div>
      )}
    </div>
  );
}
