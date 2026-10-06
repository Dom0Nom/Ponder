import { useEffect, useMemo, useRef, useState } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessageSquarePlus, MessagesSquare, MoreHorizontal, Settings2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk, useMessages, useSources, useThreads } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, Thread } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { useChatStream } from "../../stores/chatStream";
import { Button } from "../../components/ui/button";
import { ConfirmDialog, Dialog } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { MessageView } from "./MessageView";
import { Composer } from "./Composer";

export function ChatPane({ space }: { space: Space }) {
  const threads = useThreads(space.id);
  const activeId = useUi((st) => st.activeThread[space.id]);
  const setActive = useUi((st) => st.setActiveThread);
  const qc = useQueryClient();
  const active: Thread | undefined =
    threads.data?.find((t) => t.id === activeId) ?? threads.data?.[0];

  const newThread = async () => {
    try {
      const t = await api.createThread(space.id);
      qc.invalidateQueries({ queryKey: qk.threads(space.id) });
      setActive(space.id, t.id);
      return t;
    } catch (e) {
      toastError(s.errors.generic, e, newThread);
      throw e;
    }
  };

  return (
    <section
      aria-label={s.panes.chat}
      data-testid="pane-chat"
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-pane)] bg-surface shadow-card"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <ThreadSwitcher space={space} threads={threads.data ?? []} active={active} />
        <Button variant="ghost" size="sm" onClick={newThread}>
          <MessageSquarePlus size={16} /> {s.chat.newThread}
        </Button>
      </div>
      {threads.isLoading ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      ) : threads.error ? (
        <ErrorState title={s.errors.generic} error={threads.error} onRetry={() => threads.refetch()} />
      ) : (
        <ThreadView key={active?.id ?? "none"} space={space} thread={active} ensureThread={newThread} />
      )}
    </section>
  );
}

function ThreadSwitcher({ space, threads, active }: { space: Space; threads: Thread[]; active?: Thread }) {
  const setActive = useUi((st) => st.setActiveThread);
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState("");

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DM.Root>
        <DM.Trigger asChild>
          <button className="flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.9375rem] font-medium hover:bg-surface-2">
            <MessagesSquare size={16} className="shrink-0 text-muted" />
            <span className="truncate">{active?.title ?? s.panes.chat}</span>
            {threads.length > 0 && <ChevronDown size={15} className="shrink-0 text-muted" />}
          </button>
        </DM.Trigger>
        {threads.length > 0 && (
          <DM.Portal>
            <DM.Content align="start" className="z-50 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg">
              <DM.Label className="px-3 py-1.5 text-xs text-muted">{s.chat.threads}</DM.Label>
              {threads.map((t) => (
                <DM.Item
                  key={t.id}
                  onSelect={() => setActive(space.id, t.id)}
                  className="cursor-pointer truncate rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2 data-[active=true]:font-medium"
                  data-active={t.id === active?.id}
                >
                  {t.title}
                </DM.Item>
              ))}
            </DM.Content>
          </DM.Portal>
        )}
      </DM.Root>
      {active && (
        <DM.Root>
          <DM.Trigger asChild>
            <button aria-label="Chat options" className="rounded-full p-1.5 text-muted hover:bg-surface-2">
              <MoreHorizontal size={16} />
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="start" className="z-50 min-w-40 rounded-xl border border-border bg-surface p-1 shadow-lg">
              <DM.Item
                onSelect={() => {
                  setTitle(active.title);
                  setRenaming(true);
                }}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
              >
                {s.chat.renameThread}
              </DM.Item>
              <DM.Item
                onSelect={() => setDeleting(true)}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft"
              >
                {s.chat.deleteThread}
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title={s.chat.renameThread}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {s.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={async () => {
                try {
                  await api.renameThread(active!.id, title);
                  qc.invalidateQueries({ queryKey: qk.threads(space.id) });
                  setRenaming(false);
                } catch (e) {
                  toastError(s.errors.generic, e);
                }
              }}
            >
              {s.common.save}
            </Button>
          </>
        }
      >
        <Input autoFocus aria-label={s.chat.renameThread} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`${s.chat.deleteThread}?`}
        body={active ? `“${active.title}” and its messages are deleted.` : ""}
        confirmLabel={s.common.delete}
        danger
        onConfirm={async () => {
          try {
            await api.deleteThread(active!.id);
            qc.invalidateQueries({ queryKey: qk.threads(space.id) });
          } catch (e) {
            toastError(s.errors.generic, e);
          }
        }}
      />
    </div>
  );
}

function ThreadView({ space, thread, ensureThread }: { space: Space; thread?: Thread; ensureThread: () => Promise<Thread> }) {
  const messages = useMessages(thread?.id);
  const sources = useSources(space.id);
  const live = useChatStream((st) => st.live);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const navigate = useUi((st) => st.navigate);

  const list = useMemo(() => messages.data ?? [], [messages.data]);
  const liveLen = Object.values(live).reduce((n, l) => n + l.content.length + l.reasoning.length, 0);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list.length, liveLen]);

  // content keeps growing after a stream ends (citations, footer); stay pinned to the bottom
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !content.current) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content.current);
    return () => ro.disconnect();
  }, []);

  const ready = (sources.data ?? []).filter((x) => x.status === "ready");
  const inChat = ready.filter((x) => x.useInChat);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="message-list"
      >
        <div ref={content} className="mx-auto max-w-[760px] px-6 py-6">
          {messages.isLoading && thread && (
            <div className="space-y-4">
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-28" />
            </div>
          )}
          {messages.error && (
            <ErrorState title={s.errors.generic} error={messages.error} onRetry={() => messages.refetch()} />
          )}
          {!messages.isLoading && list.length === 0 && (
            <EmptyState
              className="pt-16"
              icon={<MessagesSquare size={22} />}
              title={s.chat.emptyTitle}
              body={ready.length ? s.chat.emptyBody : s.chat.emptyNoSources}
            />
          )}
          <div className="space-y-6">
            {list.map((m) => (
              <MessageView key={m.id} message={m} space={space} live={live[m.id]} />
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[808px] px-6 pb-4">
        <p className="mb-1.5 flex items-center gap-1 px-1 text-xs text-faint">
          {s.chat.sourcesUsed(inChat.length)}
          {ready.length !== inChat.length && ` (${ready.length - inChat.length} turned off)`}
          <button
            onClick={() => navigate({ name: "settings" })}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-surface-2 hover:text-muted"
          >
            <Settings2 size={12} /> Models
          </button>
        </p>
        <Composer space={space} thread={thread} ensureThread={ensureThread} hasSources={inChat.length > 0} />
      </div>
    </div>
  );
}
