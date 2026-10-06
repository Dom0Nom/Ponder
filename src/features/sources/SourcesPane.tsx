import { useEffect, useState } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AlertCircle, BookOpen, FileText, FileType2, Globe, MoreVertical, Plus, RotateCcw, StickyNote, SquarePlay, type LucideIcon,
} from "lucide-react";
import { api, events } from "../../lib/ipc";
import { qk, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { EmbedderStatus, Source, SourceKind, Space } from "../../lib/types";
import { cn, isNativeApp } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog, Dialog } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { EmptyState, ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { fileImporter } from "../../lib/importers/files";
import { ImportDialog } from "./ImportDialog";
import { useAutoSummaries } from "./useAutoSummaries";
import { WatchedFolders } from "./WatchedFolders";

export const KIND_ICON: Record<SourceKind, LucideIcon> = {
  pdf: FileType2,
  epub: BookOpen,
  docx: FileText,
  markdown: StickyNote,
  text: StickyNote,
  url: Globe,
  youtube: SquarePlay,
};

export function SourcesPane({ space }: { space: Space }) {
  const { data, isLoading, error, refetch } = useSources(space.id);
  const importDialog = useUi((st) => st.importDialog);
  const setImportDialog = useUi((st) => st.setImportDialog);
  const [dragging, setDragging] = useState(false);
  const qc = useQueryClient();
  useAutoSummaries(space, data);

  useEffect(() => {
    if (!isNativeApp()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(async (e) => {
        if (e.payload.type === "over" || e.payload.type === "enter") setDragging(true);
        else if (e.payload.type === "leave") setDragging(false);
        else if (e.payload.type === "drop") {
          setDragging(false);
          for (const path of e.payload.paths) {
            if (!fileImporter.canHandle(path)) {
              toastError(s.sources.importFailed, new Error(`Unsupported file: ${path.split("/").pop()}`));
              continue;
            }
            try {
              await fileImporter.import(space.id, path);
            } catch (err) {
              toastError(s.sources.importFailed, err);
            }
          }
          qc.invalidateQueries({ queryKey: qk.sources(space.id) });
        }
      })
      .then((f) => (unlisten = f))
      .catch(() => {});
    return () => unlisten?.();
  }, [space.id, qc]);

  const all = data ?? [];
  const usable = all.filter((x) => x.status === "ready");
  const allOn = usable.length > 0 && usable.every((x) => x.useInChat);

  const toggleAll = async (on: boolean) => {
    try {
      await Promise.all(usable.map((x) => api.updateSource(x.id, { useInChat: on })));
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };

  return (
    <div className={cn("relative flex h-full flex-col", dragging && "ring-2 ring-inset ring-accent")}>
      <div className="p-3">
        <Button variant="secondary" className="w-full" onClick={() => setImportDialog({ open: true })}>
          <Plus size={17} /> {s.sources.add}
        </Button>
      </div>
      <WatchedFolders space={space} />
      <EmbedderBanner />
      {isLoading && (
        <div className="space-y-2 px-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {error && <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />}
      {data && all.length === 0 && (
        <EmptyState className="flex-1" icon={<FileText size={22} />} title={s.sources.emptyTitle} body={s.sources.emptyBody} />
      )}
      {all.length > 0 && (
        <>
          <label className="flex items-center justify-between px-5 pb-1 pt-1 text-xs text-muted">
            <span>Select all sources</span>
            <Switch label="Select all sources" checked={allOn} disabled={!usable.length} onCheckedChange={toggleAll} />
          </label>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" data-testid="source-list">
            {all.map((src) => (
              <SourceRow key={src.id} source={src} />
            ))}
          </ul>
        </>
      )}
      <ImportDialog
        space={space}
        open={importDialog.open}
        initialTab={importDialog.tab}
        onOpenChange={(open) => setImportDialog({ open })}
      />
    </div>
  );
}

function EmbedderBanner() {
  const [st, setSt] = useState<EmbedderStatus | null>(null);
  useEffect(() => {
    api.embedderStatus().then(setSt).catch(() => {});
    const un = events.embedderStatus(setSt);
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);
  if (!st || st.state === "ready" || st.state === "missing") return null;
  return (
    <div className={cn("mx-3 mb-2 rounded-xl px-3 py-2 text-xs", st.state === "error" ? "bg-danger-soft" : "bg-surface-2 text-muted")}>
      {st.state === "error" ? (
        <>
          <p className="font-medium text-danger">{s.sources.embedderError}</p>
          <p className="mt-0.5 break-words">{st.error}</p>
        </>
      ) : st.state === "downloading" ? (
        <>
          {s.sources.embedderDownloading(st.progress)}
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(st.progress * 100)}%` }} />
          </div>
        </>
      ) : (
        "Loading the search model…"
      )}
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const qc = useQueryClient();
  const openViewer = useUi((st) => st.openViewer);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(source.title);
  const Icon = KIND_ICON[source.kind] ?? FileText;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.sources(source.spaceId) });

  const patch = async (p: { title?: string; useInChat?: boolean }) => {
    try {
      await api.updateSource(source.id, p);
      refresh();
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };
  const retry = async () => {
    try {
      await api.reindexSource(source.id);
      refresh();
    } catch (e) {
      toastError(s.sources.importFailed, e, retry);
    }
  };

  return (
    <li
      className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-surface-2"
      data-testid="source-row"
      data-status={source.status}
    >
      <Icon size={17} className={cn("shrink-0", source.status === "error" ? "text-danger" : "text-muted")} />
      <button
        className="min-w-0 flex-1 text-left"
        onClick={() => source.status !== "processing" && openViewer({ sourceId: source.id })}
        disabled={source.status === "processing"}
      >
        <p className="truncate text-[0.8125rem] font-medium">{source.title}</p>
        {source.status === "processing" && (
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(4, Math.round(source.progress * 100))}%` }}
              />
            </div>
            <span className="text-[0.6875rem] text-faint">{s.sources.processing}</span>
          </div>
        )}
        {source.status === "error" && (
          <p className="mt-0.5 flex items-start gap-1 text-[0.6875rem] text-danger">
            <AlertCircle size={11} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{source.error ?? s.sources.error}</span>
          </p>
        )}
      </button>
      {source.status === "error" && (
        <button aria-label={s.sources.retry} title={s.sources.retry} onClick={retry} className="rounded-full p-1.5 text-muted hover:bg-surface-3">
          <RotateCcw size={14} />
        </button>
      )}
      <DM.Root>
        <DM.Trigger asChild>
          <button aria-label="Source options" className="rounded-full p-1 text-muted opacity-0 hover:bg-surface-3 focus:opacity-100 group-hover:opacity-100">
            <MoreVertical size={15} />
          </button>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content align="end" className="z-50 min-w-36 rounded-xl border border-border bg-surface p-1 shadow-lg">
            <DM.Item onSelect={() => setRenaming(true)} className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
              {s.common.rename}
            </DM.Item>
            <DM.Item onSelect={() => setDeleting(true)} className="cursor-pointer rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft">
              {s.common.delete}
            </DM.Item>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      <input
        type="checkbox"
        aria-label={`${s.sources.useInChat}: ${source.title}`}
        checked={source.useInChat}
        disabled={source.status !== "ready"}
        onChange={(e) => patch({ useInChat: e.target.checked })}
        className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)] disabled:cursor-default disabled:opacity-40"
      />
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title={s.common.rename}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {s.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={async () => {
                await patch({ title: title.trim() });
                setRenaming(false);
              }}
            >
              {s.common.save}
            </Button>
          </>
        }
      >
        <Input autoFocus aria-label={s.common.rename} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={s.sources.deleteTitle}
        body={s.sources.deleteBody}
        confirmLabel={s.common.delete}
        danger
        onConfirm={async () => {
          try {
            await api.deleteSource(source.id);
            refresh();
            qc.invalidateQueries({ queryKey: qk.spaces });
            toast.success(`Deleted “${source.title}”`);
          } catch (e) {
            toastError(s.errors.generic, e);
          }
        }}
      />
    </li>
  );
}
