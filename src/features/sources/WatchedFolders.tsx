import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Folder, FolderSync, Loader2, X } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk, useWatchedFolders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, WatchedFolder } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog, Dialog } from "../../components/ui/dialog";
import { EmptyState, ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";

const needsAttention = (f: WatchedFolder) => f.status === "missing" || f.status === "error";

function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/** Entry row in the Sources pane plus the dialog it opens. */
export function WatchedFolders({ space }: { space: Space }) {
  const { data } = useWatchedFolders(space.id);
  const open = useUi((st) => st.watchDialogOpen);
  const setOpen = useUi((st) => st.setWatchDialogOpen);
  const attention = data?.some(needsAttention);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mx-3 mb-2 flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        data-testid="watched-folders-entry"
      >
        <FolderSync size={14} />
        <span className="flex-1 text-left">{s.watch.open}</span>
        {attention ? (
          <AlertCircle size={14} className="text-danger" aria-label={s.watch.attention} />
        ) : (
          !!data?.length && <span className="tabular-nums">{data.length}</span>
        )}
      </button>
      <WatchedFoldersDialog space={space} open={open} onOpenChange={setOpen} />
    </>
  );
}

function WatchedFoldersDialog({ space, open, onOpenChange }: { space: Space; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading, error, refetch } = useWatchedFolders(space.id);
  const qc = useQueryClient();
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
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-sm text-muted">
            <Switch label={s.watch.recursive} checked={recursive} onCheckedChange={setRecursive} />
            {s.watch.recursive}
          </label>
          <Button variant="primary" onClick={add} disabled={adding}>
            {adding ? <Loader2 size={16} className="animate-spin" /> : <Folder size={16} />}
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
        <ul className="space-y-1 py-1" data-testid="watched-folder-list">
          {data.map((f) => (
            <FolderRow key={f.id} folder={f} onRemoved={refresh} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function FolderRow({ folder, onRemoved }: { folder: WatchedFolder; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const qc = useQueryClient();
  const name = folderName(folder.path);
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

  return (
    <li className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2" data-testid="watched-folder" data-status={folder.status}>
      <span className={cn("mt-0.5 rounded-lg p-1.5", bad ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-text")}>
        {bad ? <AlertCircle size={16} /> : <Folder size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-faint" title={folder.path}>
          {folder.path}
        </p>
        <p className={cn("mt-0.5 flex items-center gap-1 text-xs", bad ? "text-danger" : "text-muted")}>
          {folder.status === "scanning" && <Loader2 size={11} className="animate-spin" />}
          {s.watch.files(folder.fileCount)} · {s.watch.status[folder.status]}
          {!folder.recursive && ` · ${s.watch.topLevelOnly}`}
        </p>
        {bad && folder.error && <p className="mt-0.5 break-words text-xs text-danger">{folder.error}</p>}
      </div>
      <button
        aria-label={`${s.watch.remove}: ${name}`}
        title={s.watch.remove}
        onClick={() => setConfirming(true)}
        className="rounded-full p-1.5 text-muted hover:bg-surface-3 hover:text-fg"
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
