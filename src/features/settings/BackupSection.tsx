import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, events } from "../../lib/ipc";
import { qk, useBackupStatus } from "../../lib/queries";
import { s } from "../../lib/strings";
import { formatSize } from "../../lib/importers/cloud";
import type { BackupInfo, BackupStatus } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { NativeSelect } from "./NativeSelect";
import { SettingsGroup, SettingsRow } from "./layout";

const KEEP_OPTIONS = [3, 7, 14, 30];

export function BackupSection() {
  const { data, isLoading, error, refetch } = useBackupStatus();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);

  useEffect(() => {
    const un = events.backupUpdated(() => void qc.invalidateQueries({ queryKey: qk.backups }));
    return () => void un.then((f) => f());
  }, [qc]);

  const apply = (st: BackupStatus): void => void qc.setQueryData(qk.backups, st);
  const run = async (fn: () => Promise<void>, title: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toastError(title, e);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !data) return <ErrorState title={s.backup.loadError} error={error} onRetry={() => refetch()} />;
  const { config } = data;
  const configure = (patch: Partial<typeof config>) => {
    const next = { ...config, ...patch };
    void run(async () => apply(await api.backupConfigure(next.enabled, next.frequency, next.keep)), s.errors.generic);
  };
  const keepOptions = KEEP_OPTIONS.includes(config.keep) ? KEEP_OPTIONS : [...KEEP_OPTIONS, config.keep].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-3" data-testid="backup-settings">
      {data.restoreStaged && (
        <div role="status" className="flex items-center gap-3 rounded-card border border-border bg-fill-subtle px-4 py-3" data-testid="backup-staged">
          <div className="min-w-0 flex-1">
            <p className="text-input font-medium">{s.backup.staged}</p>
            <p className="text-caption text-muted">{s.backup.stagedBody}</p>
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => apply(await api.backupCancelRestore()), s.errors.generic)}>
            {s.backup.cancelRestore}
          </Button>
          <Button size="sm" variant="primary" onClick={() => run(() => api.restartApp(), s.errors.generic)}>
            {s.backup.restartNow}
          </Button>
        </div>
      )}
      <SettingsGroup>
        <SettingsRow title={s.backup.folder} description={config.folder ?? s.backup.noFolder}>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => run(async () => apply(await api.backupChooseFolder()), s.backup.chooseFailed)}
          >
            {config.folder ? s.backup.change : s.backup.choose}
          </Button>
        </SettingsRow>
        <SettingsRow title={s.backup.enable}>
          <Switch label={s.backup.enable} checked={config.enabled} disabled={busy || !config.folder} onCheckedChange={(on) => configure({ enabled: on })} />
        </SettingsRow>
        <SettingsRow title={s.backup.frequency}>
          <NativeSelect
            className="w-36"
            aria-label={s.backup.frequency}
            value={config.frequency}
            disabled={busy}
            onChange={(e) => configure({ frequency: e.target.value as typeof config.frequency })}
          >
            {(["daily", "weekly"] as const).map((f) => (
              <option key={f} value={f}>
                {s.backup.frequencies[f]}
              </option>
            ))}
          </NativeSelect>
        </SettingsRow>
        <SettingsRow title={s.backup.keep}>
          <NativeSelect
            className="w-36"
            aria-label={s.backup.keep}
            value={config.keep}
            disabled={busy}
            onChange={(e) => configure({ keep: Number(e.target.value) })}
          >
            {keepOptions.map((n) => (
              <option key={n} value={n}>
                {s.backup.keepOption(n)}
              </option>
            ))}
          </NativeSelect>
        </SettingsRow>
      </SettingsGroup>
      {data.lastError && <p className="text-caption text-danger-text">{s.backup.lastError}: {data.lastError}</p>}
      <div className="flex items-center justify-between">
        <h3 className="text-input font-semibold">{s.backup.listTitle}</h3>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !config.folder || data.running}
          onClick={() =>
            run(async () => {
              await api.backupNow();
              await qc.invalidateQueries({ queryKey: qk.backups });
              toast(s.backup.done);
            }, s.backup.failed)
          }
        >
          {busy || data.running ? s.backup.running : s.backup.now}
        </Button>
      </div>
      {data.backups.length === 0 ? (
        <p className="rounded-card border border-border px-4 py-5 text-body text-muted">
          <span className="font-medium text-fg">{s.backup.empty}.</span> {s.backup.emptyBody}
        </p>
      ) : (
        <SettingsGroup data-testid="backup-list">
          {data.backups.map((b) => (
            <SettingsRow key={b.name} title={new Date(b.createdAt).toLocaleString()} description={formatSize(b.size)}>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRestoring(b)}>
                {s.backup.restore}
              </Button>
              <Button
                size="sm"
                variant="ghost-muted"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    apply(await api.backupDelete(b.name));
                    toast(s.backup.deleted);
                  }, s.errors.generic)
                }
              >
                {s.backup.delete}
              </Button>
            </SettingsRow>
          ))}
        </SettingsGroup>
      )}
      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title={s.backup.restoreTitle}
        body={restoring ? s.backup.restoreBody(new Date(restoring.createdAt).toLocaleString()) : ""}
        confirmLabel={s.backup.restoreConfirm}
        danger
        onConfirm={() => {
          const name = restoring?.name;
          if (name) void run(async () => apply(await api.backupRestore(name)), s.backup.restoreFailed);
        }}
      />
    </div>
  );
}
