import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk, usePinThread, useThreads } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Thread } from "../../lib/types";
import { cn, dayGroup } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { discardThread, undiscardThread } from "../../stores/chatStream";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../components/ui/menu";
import { Skeleton, Tooltip } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { useFlip } from "../../lib/useFlip";
import { LikeIcon } from "../../components/motion/LikeIcon";
import { useFreshKeys } from "../../lib/useFreshKeys";
import { useActiveThread, useNewThread } from "./useActiveThread";

const GROUP_ORDER = ["pinned", "today", "yesterday", "week", "month", "older"] as const;
type Group = (typeof GROUP_ORDER)[number];

export function groupThreads(threads: Thread[], now = Date.now()): { group: Group; items: Thread[] }[] {
  const buckets = new Map<Group, Thread[]>();
  for (const t of threads) {
    const g: Group = t.pinned ? "pinned" : dayGroup(t.updatedAt, now);
    buckets.set(g, [...(buckets.get(g) ?? []), t]);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({ group: g, items: buckets.get(g)! }));
}

const iconBtn = "flex size-6 shrink-0 items-center justify-center rounded-item hover:bg-overlay";

function RenameInput({ thread, spaceId }: { thread: Thread; spaceId: string }) {
  const setRenaming = useUi((st) => st.setRenamingThread);
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = async (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const title = ref.current?.value.trim() ?? "";
    setRenaming(null);
    if (!save || !title || title === thread.title) return;
    try {
      await api.renameThread(thread.id, title);
      qc.invalidateQueries({ queryKey: qk.threads(spaceId) });
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };
  return (
    <input
      ref={ref}
      defaultValue={thread.title}
      aria-label={s.chat.renameThread}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="-ms-[7px] h-6 min-w-0 flex-1 rounded-kbd border border-fg bg-surface px-1.5 font-medium text-fg outline-none"
    />
  );
}

function ThreadRow({ thread, spaceId, active, fresh, onDelete }: { thread: Thread; spaceId: string; active: boolean; fresh: boolean; onDelete: () => void }) {
  const setActive = useUi((st) => st.setActiveThread);
  const renaming = useUi((st) => st.renamingThreadId === thread.id);
  const setRenaming = useUi((st) => st.setRenamingThread);
  const pin = usePinThread(spaceId);
  const [menuOpen, setMenuOpen] = useState(false);
  const togglePin = () => pin.mutate({ id: thread.id, pinned: !thread.pinned });
  const pinLabel = thread.pinned ? s.chat.unpin : s.chat.pin;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      data-testid="thread-row"
      data-flip-key={thread.id}
      data-open={fresh || undefined}
      onClick={() => !renaming && setActive(spaceId, thread.id)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          setActive(spaceId, thread.id);
        }
      }}
      className={cn(
        "group relative flex h-8 shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-btn ps-4 pe-1.5",
        fresh && "t-panel-slide",
        active ? "bg-selected font-semibold" : "font-medium hover:bg-fill-hover",
        menuOpen && !active && "bg-fill-hover",
      )}
    >
      {renaming ? (
        <RenameInput thread={thread} spaceId={spaceId} />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          <Tooltip content={pinLabel}>
            <button
              aria-label={pinLabel}
              onClick={(e) => {
                e.stopPropagation();
                togglePin();
              }}
              className={cn(iconBtn, thread.pinned ? "flex" : "hidden opacity-50 group-hover:flex", menuOpen && "flex")}
            >
              <LikeIcon on={thread.pinned}>
                <Pin size={14} />
              </LikeIcon>
            </button>
          </Tooltip>
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <Tooltip content={s.chat.more}>
              <MenuTrigger asChild>
                <button
                  aria-label={s.chat.more}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(iconBtn, menuOpen ? "flex" : "hidden group-hover:flex group-focus-within:flex")}
                >
                  <Ellipsis size={14} />
                </button>
              </MenuTrigger>
            </Tooltip>
            <MenuContent
              align="end"
              className="w-[148px]"
              onClick={(e) => e.stopPropagation()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <MenuItem onSelect={() => setRenaming(thread.id)}>
                <Pencil size={14} /> {s.common.rename}
              </MenuItem>
              <MenuItem onSelect={togglePin}>
                {thread.pinned ? <PinOff size={14} /> : <Pin size={14} />} {pinLabel}
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={onDelete}>
                <Trash2 size={14} /> {s.common.delete}
              </MenuItem>
            </MenuContent>
          </Menu>
        </>
      )}
    </div>
  );
}

export function ThreadList({ spaceId }: { spaceId: string }) {
  const threads = useThreads(spaceId);
  const active = useActiveThread(spaceId);
  const newThread = useNewThread(spaceId);
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const groups = useMemo(() => groupThreads(threads.data ?? []), [threads.data]);
  const listRef = useRef<HTMLDivElement>(null);
  const isFresh = useFreshKeys(threads.data?.map((t) => t.id));
  useFlip(listRef, [threads.data]);

  if (!threads.isLoading && !threads.error && !threads.data?.length) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5" data-testid="thread-list">
      <div className="relative h-[38px] shrink-0">
        <span aria-hidden className="absolute -inset-x-3 top-2.5 h-px bg-border" />
        <Tooltip content={s.chat.newThread}>
          <button
            aria-label={s.chat.newThread}
            onClick={() => newThread().catch(() => {})}
            className="absolute -bottom-1 end-1 flex size-6 items-center justify-center rounded-btn hover:bg-pressed"
          >
            <Plus size={15} />
          </button>
        </Tooltip>
      </div>
      <div ref={listRef} className="relative -mx-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {threads.isLoading && (
          <div className="space-y-2 px-4 pt-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        )}
        {threads.error && (
          <button className="px-4 py-3 text-start text-muted hover:text-fg" onClick={() => threads.refetch()}>
            {s.errors.generic} · {s.common.retry}
          </button>
        )}
        {groups.map(({ group, items }) => (
          <div key={group} className="m-stagger m-stagger-sm flex flex-col gap-0.5">
            <p className="whitespace-nowrap px-4 pb-1 pt-2.5 text-label font-semibold text-muted">{s.shell.groups[group]}</p>
            {items.map((t) => (
              <ThreadRow key={t.id} thread={t} spaceId={spaceId} active={t.id === active?.id} fresh={isFresh(t.id)} onDelete={() => setDeleting(t)} />
            ))}
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`${s.chat.deleteThread}?`}
        body={deleting ? `“${deleting.title}” and its messages are deleted.` : ""}
        confirmLabel={s.common.delete}
        danger
        onConfirm={async () => {
          if (!deleting) return;
          discardThread(deleting.id);
          try {
            await api.deleteThread(deleting.id);
            qc.invalidateQueries({ queryKey: qk.threads(spaceId) });
          } catch (e) {
            undiscardThread(deleting.id);
            toastError(s.errors.generic, e);
          }
        }}
      />
    </div>
  );
}
