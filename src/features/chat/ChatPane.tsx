import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Layers, Plus, Sparkles } from "lucide-react";
import { useMessages, useSources, useThreads } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, Thread } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useChatStream } from "../../stores/chatStream";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { ThinkingLine } from "../../components/motion/ThinkingLine";
import { PonderMark } from "../../components/brand/PonderMark";
import { useLowEnergy } from "../focus/useLowEnergy";
import { MessageView } from "./MessageView";
import { Composer } from "./Composer";
import { useActiveThread, useNewThread } from "./useActiveThread";

export function ChatPane({ space }: { space: Space }) {
  const threads = useThreads(space.id);
  const active = useActiveThread(space.id);
  const newThread = useNewThread(space.id);

  if (threads.isLoading)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  if (threads.error) return <ErrorState title={s.errors.generic} error={threads.error} onRetry={() => threads.refetch()} />;
  return <ThreadView key={active?.id ?? "none"} space={space} thread={active} ensureThread={newThread} />;
}

function NewChatState({ hasSources, sourcesOpen, space }: { hasSources: boolean; sourcesOpen: boolean; space: Space }) {
  const setImportDialog = useUi((st) => st.setImportDialog);
  const low = useLowEnergy(space.id);
  return (
    <div className="t-stagger is-shown flex min-h-full flex-1 flex-col items-center justify-center gap-2.5 p-10 text-center" data-testid="chat-empty">
      <div aria-hidden className="relative h-11">
        <PonderMark size={56} state="idle" className="absolute bottom-2.5 left-1/2 -translate-x-1/2" />
      </div>
      <p className="t-stagger-line text-section font-semibold">{s.chat.emptyTitle}</p>
      <p className="t-stagger-line t-stagger-line--2 max-w-[380px] text-body-lg leading-[1.5] text-muted">{hasSources ? s.chat.emptyBody : s.chat.emptyNoSources}</p>
      {!hasSources && !sourcesOpen && (
        <div className="t-stagger-line t-stagger-line--3 relative mt-2">
          <Button className="font-semibold" disabled={low.active} title={low.reason} onClick={() => setImportDialog({ open: true })}>
            <Plus size={15} /> {s.sources.add}
          </Button>
          <Button variant="primary" className="absolute left-1/2 top-full mt-3 -translate-x-1/2 font-semibold" disabled={low.active} title={low.reason} onClick={() => setImportDialog({ open: true, tab: "research" })}>
            <Sparkles size={15} /> {s.sources.findSources}
          </Button>
        </div>
      )}
    </div>
  );
}

function ThreadView({ space, thread, ensureThread }: { space: Space; thread?: Thread; ensureThread: () => Promise<Thread> }) {
  const messages = useMessages(thread?.id);
  const sources = useSources(space.id);
  const live = useChatStream((st) => st.live);
  const phase = useChatStream((st) => (thread ? st.phase[thread.id] : undefined));
  const activity = useChatStream((st) => (thread ? st.activity[thread.id] : undefined));
  const sourcesOpen = useUi((st) => st.sourcesOpen[space.id] === true);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const list = useMemo(() => messages.data ?? [], [messages.data]);
  const visible = useMemo(() => list.filter((m) => !m.meta?.secondOpinionOf), [list]);
  const latestAnswerId = [...visible].reverse().find((m) => m.role === "assistant")?.id;
  const dividerAfter = thread?.summary && thread.summaryUntil != null ? [...visible].reverse().find((m) => m.createdAt <= thread.summaryUntil!)?.id : undefined;
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
  const empty = !messages.isLoading && !messages.error && list.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto transition-[padding] duration-200"
        style={{ paddingInlineStart: sourcesOpen ? 340 : 0 }}
        data-testid="message-list"
      >
        <div ref={content} className="mx-auto flex w-full max-w-[748px] flex-1 flex-col gap-[26px] px-6 pb-7 pt-8">
          {messages.isLoading && thread && (
            <div className="space-y-4">
              <Skeleton className="ms-auto h-10 w-1/2" />
              <Skeleton className="h-28" />
            </div>
          )}
          {messages.error && <ErrorState title={s.errors.generic} error={messages.error} onRetry={() => messages.refetch()} />}
          {empty && <NewChatState hasSources={ready.length > 0} sourcesOpen={sourcesOpen} space={space} />}
          {visible.map((m) => (
            <Fragment key={m.id}>
              <MessageView
                message={m}
                space={space}
                live={live[m.id]}
                seconds={list.filter((x) => x.meta?.secondOpinionOf === m.id)}
                allLive={live}
                latest={m.id === latestAnswerId}
              />
              {m.id === dividerAfter && thread?.summary && <CompactionDivider summary={thread.summary} />}
            </Fragment>
          ))}
          {(phase || activity) && (
            <span data-testid="chat-status" className="inline-flex items-center gap-2 text-label font-medium text-fg-secondary">
              <ActivityOrb activity={phase === "compact" ? "write" : activity ? "read" : "search"} size={16} />
              <ThinkingLine label={phase === "compact" ? s.chat.compacting : phase === "plan" ? s.chat.planningSearch : (activity ?? s.chat.searchingSources)} />
            </span>
          )}
        </div>
      </div>
      <div className={cn("shrink-0 pe-6 transition-[padding] duration-200", empty ? "pb-6" : "pb-[18px]")} style={{ paddingInlineStart: sourcesOpen ? 364 : 24 }}>
        <Composer
          space={space}
          thread={thread}
          ensureThread={ensureThread}
          sources={{ ready: ready.length, inChat: inChat.length }}
        />
      </div>
    </div>
  );
}

/** Marks where a compaction summary stands in for earlier messages; expands to show it. */
function CompactionDivider({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="compaction-divider" className="flex flex-col gap-2">
      <button aria-expanded={open} onClick={() => setOpen(!open)} className="group flex items-center gap-3 text-label font-medium text-muted hover:text-fg-secondary">
        <span className="h-px flex-1 bg-border" />
        <Layers size={13} />
        {s.chat.earlierSummarized}
        <ChevronDown size={13} className={cn("transition-transform duration-[var(--motion-quick)]", open && "rotate-180")} />
        <span className="h-px flex-1 bg-border" />
      </button>
      <div className="t-acc" data-open={open ? "true" : "false"}>
        <div className="t-acc-panel">
          <div className="overflow-hidden">
            <p className="whitespace-pre-wrap rounded-card bg-fill px-4 py-3 text-body text-fg-secondary">{summary}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
