import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { api, events } from "../../../lib/ipc";
import { qk, useMusicStatus } from "../../../lib/queries";
import { useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { parsePlaylistUri } from "../../../lib/music";
import { s } from "../../../lib/strings";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { ErrorState, Skeleton, Spinner, Switch } from "../../../components/ui/misc";
import { toast, toastError } from "../../../components/ui/toast";

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
  if (status.isLoading || isLoading) return <Skeleton className="h-24" />;
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
    <div data-testid="music-settings">
      <h3 className="text-sm font-semibold">{s.music.title}</h3>
      <p className="mt-0.5 text-sm text-muted">{s.music.body}</p>
      <div className="flex items-center justify-between gap-6 py-2.5">
        <span className="text-sm">{s.music.enable}</span>
        <Switch label={s.music.enable} checked={enabled} onCheckedChange={(on) => save({ enabled: on, playlist })} />
      </div>
      {enabled && (
        <div className="space-y-2">
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
                <p role="alert" className="mt-1.5 text-[0.8125rem] text-danger">
                  {invalid}
                </p>
              )}
            </div>
            <Button disabled={!parsed.ok || testing} onClick={() => void test()}>
              {testing ? <Spinner /> : null}
              {testing ? s.music.testing : s.music.test}
            </Button>
          </div>
          <p className="text-[0.8125rem] text-muted">{s.music.permissionHint}</p>
        </div>
      )}
      {status.data.lastError && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-danger">{s.music.lastError}</p>
            <p className="mt-0.5 break-words text-muted">{status.data.lastError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
