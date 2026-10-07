import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderPlus, FolderSync, Loader2, X } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk, useWatchedFolders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, WatchedFolder } from "../../lib/types";
import { cn, isNativeApp, tildePath } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { ConfirmDialog, Dialog } from "../../components/ui/dialog";
import { EmptyState, ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";

export const needsAttention = (f: WatchedFolder) => f.status === "missing" || f.status === "error";

function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

let homePromise: Promise<string> | null = null;
function useHomeDir() {
  const [home, setHome] = useState("");
  useEffect(() => {
    if (!isNativeApp()) return;
    homePromise ??= import("@tauri-apps/api/path").then((m) => m.homeDir());
    homePromise.then(setHome).catch(() => {});
  }, []);
  return home;
}

export function WatchedFoldersDialog({ space, open, onOpenChange }: { space: Space; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading, error, refetch } = useWatchedFolders(space.id);
  const qc = useQueryClient();
  const home = useHomeDir();
  const [recursive, setRecursive] = useState(true);
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.watched(space.id) });

  const add = async () => {
    let path: string | null = null;
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: s.watch.add });
      path = Array.isArray(picked) ? (picked[0] ?? null) : picked;
    } catch (e) {
      toastError(s.watch.addFailed, e);
      return;
    }
    if (!path) return;
    setAdding(true);
    try {
      await api.watchAdd(space.id, path, recursive);
      refresh();
    } catch (e) {
      toastError(s.watch.addFailed, e);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.watch.title}
      description={s.watch.body}
      className="w-[min(520px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {s.common.close}
          </Button>
          <Button variant="primary" onClick={add} disabled={adding}>
            {adding ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />}
            {adding ? s.watch.adding : s.watch.add}
          </Button>
        </>
      }
    >
      {isLoading && (
        <div className="space-y-2 py-1">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
      {error && <ErrorState title={s.watch.loadError} error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && (
        <EmptyState icon={<FolderSync size={22} />} title={s.watch.emptyTitle} body={s.watch.emptyBody} className="py-8" />
      )}
      {data && data.length > 0 && (
        <ul className="rounded-card border border-border px-4" data-testid="watched-folder-list">
          {data.map((f) => (
            <FolderRow key={f.id} folder={f} home={home} onRemoved={refresh} />
          ))}
        </ul>
      )}
      <label className="mt-3.5 flex w-fit items-center gap-2.5 text-body">
        <Switch label={s.watch.recursive} checked={recursive} onCheckedChange={setRecursive} />
        {s.watch.recursive}
      </label>
    </Dialog>
  );
}

function FolderRow({ folder, home, onRemoved }: { folder: WatchedFolder; home: string; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const qc = useQueryClient();
  const path = tildePath(folder.path, home);
  const bad = needsAttention(folder);

  const remove = async () => {
    try {
      await api.watchRemove(folder.id);
      onRemoved();
      qc.invalidateQueries({ queryKey: qk.sources(folder.spaceId) });
      toast.success(s.watch.removed);
    } catch (e) {
      toastError(s.watch.removeFailed, e, remove);
    }
  };

  const meta =
    folder.status === "scanning"
      ? s.watch.status.scanning
      : `${s.watch.status[folder.status]}${bad ? "" : ` · ${s.watch.files(folder.fileCount)}`}`;

  return (
    <li className="flex min-h-11 items-center gap-3 border-divider py-2 [&+&]:border-t" data-testid="watched-folder" data-status={folder.status}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-lg font-medium" title={folder.path}>
          {path}
        </p>
        <p className={cn("text-label", bad ? "text-danger" : "text-muted")}>
          {meta}
          {!folder.recursive && ` · ${s.watch.topLevelOnly}`}
        </p>
        {bad && folder.error && <p className="break-words text-label text-danger">{folder.error}</p>}
      </div>
      <button
        aria-label={`${s.watch.remove}: ${folderName(folder.path)}`}
        title={s.watch.remove}
        onClick={() => setConfirming(true)}
        className="flex size-7 shrink-0 items-center justify-center rounded-btn text-muted hover:bg-fill hover:text-fg"
      >
        <X size={15} />
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={s.watch.removeTitle}
        body={s.watch.removeBody}
        confirmLabel={s.watch.remove}
        onConfirm={remove}
      />
    </li>
  );
}
