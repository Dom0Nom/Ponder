import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ellipsis, FileText, FolderSync, Plus, RotateCcw, Sparkles } from "lucide-react";
import { api, events } from "../../lib/ipc";
import { qk, useSources, useWatchedFolders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { EmbedderStatus, Source, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useResearch } from "../../stores/research";
import { useUi } from "../../stores/ui";
import { useLowEnergy } from "../focus/useLowEnergy";
import { useFreshKeys } from "../../lib/useFreshKeys";
import { TextSwap } from "../../components/motion/TextSwap";
import { useStayMounted } from "../../components/motion/useStayMounted";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { Button } from "../../components/ui/button";
import { Checkbox16 } from "../../components/ui/checkbox";
import { ConfirmDialog, Dialog } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { ErrorState, Skeleton, Spinner, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { ImportDialog } from "./ImportDialog";
import { KIND_ICON } from "./kinds";
import { useAutoSummaries } from "./useAutoSummaries";
import { useSourceDrop } from "./useSourceDrop";
import { WatchedFoldersDialog, needsAttention } from "./WatchedFolders";

/** Always mounted for the space: drag-drop, auto summaries and the dialogs that work with the panel closed. */
export function SourcesHost({ space }: { space: Space }) {
  const { data } = useSources(space.id);
  const importDialog = useUi((st) => st.importDialog);
  const setImportDialog = useUi((st) => st.setImportDialog);
  const watchOpen = useUi((st) => st.watchDialogOpen);
  const setWatchOpen = useUi((st) => st.setWatchDialogOpen);
  useAutoSummaries(space, data);
  return (
    <>
      <ImportDialog space={space} open={importDialog.open} initialTab={importDialog.tab} onOpenChange={(open) => setImportDialog({ open })} />
      <WatchedFoldersDialog space={space} open={watchOpen} onOpenChange={setWatchOpen} />
    </>
  );
}

export function SourcesPanel({ space, open }: { space: Space; open: boolean }) {
  const mounted = useStayMounted(open, 200);
  const { data, isLoading, error, refetch } = useSources(space.id);
  const setImportDialog = useUi((st) => st.setImportDialog);
  const setWatchOpen = useUi((st) => st.setWatchDialogOpen);
  const setSourcesOpen = useUi((st) => st.setSourcesOpen);
  const { data: folders } = useWatchedFolders(space.id);
  const dragging = useSourceDrop(space.id);
  const qc = useQueryClient();
  const low = useLowEnergy(space.id);
  const researching = useResearch((st) => st.runs[space.id]?.status === "running");

  const isFresh = useFreshKeys(data?.map((x) => x.id));
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

  if (!mounted) return null;
  return (
    <div
      aria-label={s.panes.sources}
      data-testid="pane-sources"
      role="region"
      data-open={open}
      inert={!open}
      style={{ "--panel-translate-x": "calc(-16px * var(--dir-x))", "--panel-translate-y": "0px" } as React.CSSProperties}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) setSourcesOpen(space.id, false);
      }}
      className={cn(
        "t-panel-slide group/panel absolute inset-y-px start-px z-10 flex w-[341px] flex-col overflow-hidden border-e border-border bg-surface",
        dragging && "ring-2 ring-inset ring-fg/30",
      )}
    >
      <div className="flex h-[49px] shrink-0 items-center gap-2 border-b border-divider ps-4 pe-2.5">
        <h2 className="flex-1 text-input font-semibold">{s.panes.sources}</h2>
        {researching && (
          <button
            aria-label={s.research.runningIndicator}
            title={s.research.runningIndicator}
            data-testid="research-indicator"
            onClick={() => setImportDialog({ open: true, tab: "research" })}
            className="flex size-7 items-center justify-center rounded-btn hover:bg-fill"
          >
            <Spinner size={14} />
          </button>
        )}
        <Button
          size="sm"
          variant="primary"
          className="px-2"
          data-testid="find-sources"
          disabled={low.active}
          title={low.reason}
          onClick={() => setImportDialog({ open: true, tab: "research" })}
        >
          {s.sources.findSources}
        </Button>
        <Tooltip content={s.watch.title}>
          <button
            aria-label={s.watch.open}
            data-testid="watched-folders-entry"
            onClick={() => setWatchOpen(true)}
            className="relative flex size-7 items-center justify-center rounded-btn text-muted hover:bg-fill hover:text-fg"
          >
            <FolderSync size={15} />
            {folders?.some(needsAttention) && <span aria-label={s.watch.attention} className="absolute end-1 top-1 size-1.5 rounded-full bg-danger" />}
          </button>
        </Tooltip>
        <button
          aria-label={s.sources.add}
          disabled={low.active}
          title={low.reason}
          onClick={() => setImportDialog({ open: true })}
          className="flex h-7.5 items-center gap-1.5 rounded-btn px-[9px] font-medium hover:bg-fill disabled:opacity-50"
        >
          <Plus size={14} />
          {s.sources.add}
        </button>
      </div>
      <EmbedderBanner />
      {isLoading && (
        <div className="space-y-2 px-2 py-1.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      )}
      {error && <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />}
      {data && all.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
          <p className="text-body text-muted">{s.sources.emptyBody}</p>
          <Button variant="primary" disabled={low.active} title={low.reason} onClick={() => setImportDialog({ open: true, tab: "research" })}>
            <Sparkles size={14} />
            {s.sources.findSources}
          </Button>
        </div>
      )}
      {all.length > 0 && (
        <ul className="m-stagger m-stagger-sm min-h-0 flex-1 overflow-y-auto px-2 py-1.5" data-testid="source-list">
          {all.map((src) => (
            <SourceRow key={src.id} source={src} fresh={isFresh(src.id)} />
          ))}
        </ul>
      )}
      {usable.length >= 2 && (
        <label className="absolute inset-x-0 bottom-0 flex h-11 cursor-pointer items-center gap-2.5 border-t border-divider bg-surface px-4 text-label font-semibold text-muted opacity-0 transition-opacity duration-(--motion-quick) focus-within:opacity-100 group-hover/panel:opacity-100">
          <Checkbox16
            aria-label={s.sources.selectAll}
            checked={allOn}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          {s.sources.allSources}
        </label>
      )}
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
    <div className={cn("mx-2 mt-2 rounded-btn px-3 py-2 text-label", st.state === "error" ? "bg-danger-hover text-danger" : "bg-fill text-muted")}>
      {st.state === "error" ? (
        <>
          <p className="font-semibold">{s.sources.embedderError}</p>
          <p className="mt-0.5 break-words">{st.error}</p>
        </>
      ) : (
        <>
          <p className="flex items-center gap-2">
            <ActivityOrb activity="plan" size={16} />
            {st.state === "downloading"
              ? s.sources.embedderDownloading(st.progress)
              : st.state === "indexing"
                ? s.sources.embedderIndexing(st.progress)
                : s.sources.embedderLoading}
          </p>
          {(st.state === "downloading" || st.state === "indexing") && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-divider">
              <div className="m-progress h-full bg-fg" style={{ width: `${Math.round(st.progress * 100)}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SourceRow({ source, fresh }: { source: Source; fresh: boolean }) {
  const qc = useQueryClient();
  const openViewer = useUi((st) => st.openViewer);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(source.title);
  const Icon = KIND_ICON[source.kind] ?? FileText;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.sources(source.spaceId) });
  const label = s.sources.kinds[source.kind];

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
      className={cn("group flex h-11 items-center gap-2.5 rounded-btn px-2 hover:bg-fill", fresh && "t-panel-slide")}
      data-open={fresh || undefined}
      data-testid="source-row"
      data-status={source.status}
    >
      <Checkbox16
        aria-label={`${s.sources.useInChat}: ${source.title}`}
        checked={source.useInChat}
        disabled={source.status !== "ready"}
        onChange={(e) => patch({ useInChat: e.target.checked })}
      />
      <Icon size={15} className={cn("shrink-0", source.status === "error" ? "text-danger" : "text-fg")} />
      <button
        className="flex min-w-0 flex-1 flex-col text-start"
        onClick={() => source.status !== "processing" && openViewer({ sourceId: source.id })}
        disabled={source.status === "processing"}
        title={source.status === "error" ? (source.error ?? s.sources.error) : source.status === "processing" ? `${Math.round(source.progress * 100)}%` : undefined}
      >
        <span className="truncate font-medium">{source.title}</span>
        <span className={cn("text-label", source.status === "error" ? "text-danger" : "text-muted")}>
          {label}
          <TextSwap text={source.status === "processing" ? `\u00a0·\u00a0${s.sources.processing}` : source.status === "error" ? `\u00a0·\u00a0${s.sources.error}` : ""} />
        </span>
      </button>
      {source.status === "error" && (
        <button aria-label={s.sources.retry} title={s.sources.retry} onClick={retry} className="flex size-7 items-center justify-center rounded-btn text-muted hover:bg-fill-active">
          <RotateCcw size={14} />
        </button>
      )}
      <Menu>
        <MenuTrigger asChild>
          <button
            aria-label={s.sources.options}
            className="hidden size-7 items-center justify-center rounded-btn text-muted hover:bg-fill-active focus:flex group-hover:flex data-[state=open]:flex"
          >
            <Ellipsis size={14} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => setRenaming(true)}>{s.common.rename}</MenuItem>
          <MenuItem danger onSelect={() => setDeleting(true)}>
            {s.common.delete}
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title={s.common.rename}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(false)}>
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
            toast.success(s.sources.deletedSource(source.title));
          } catch (e) {
            toastError(s.errors.generic, e);
          }
        }}
      />
    </li>
  );
}
