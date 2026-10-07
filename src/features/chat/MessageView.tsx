import { useMemo, useState } from "react";
import { AlertCircle, Brain, Check, ChevronRight, Copy, Globe2, RotateCcw, Timer } from "lucide-react";
import { api } from "../../lib/ipc";
import { splitSegments, citedNumbers, inferCitations } from "../../lib/chat/citations";
import { hideFollowUpMarkers } from "../../lib/chat/followUps";
import { hideMemoryMarkers } from "../../lib/chat/memory";
import { CheckButton, CheckResults, RememberedChips, SecondOpinionButton, SecondOpinions } from "./AnswerTools";
import { runTurn } from "../../lib/chat/runner";
import { NoModelError } from "../../lib/chat/llm";
import { queryClient, qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Citation, Message, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useFocusStore } from "../focus/focusStore";
import { Spinner, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { Markdown } from "./Markdown";

export function MessageView({
  message,
  space,
  live,
  seconds = [],
  allLive = {},
}: {
  message: Message;
  space: Space;
  live?: { content: string; reasoning: string };
  seconds?: Message[];
  allLive?: Record<string, { content: string; reasoning: string }>;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-testid="msg-user">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-surface-2 px-4 py-2.5 text-[0.9375rem] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.role === "buddy") {
    return (
      <div className="flex justify-center" data-testid="msg-buddy">
        <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1.5 text-xs font-medium text-accent-text">
          <Timer size={13} /> {message.content}
        </span>
      </div>
    );
  }
  if (message.role === "system") return null;
  return <AssistantMessage message={message} space={space} live={live} seconds={seconds} allLive={allLive} />;
}

/** Answer text with general/uncited segments and citation chips. */
export function AnswerBody({ content, citations, streaming }: { content: string; citations: Citation[]; streaming: boolean }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const shown = useMemo(
    () =>
      streaming
        ? hideFollowUpMarkers(hideMemoryMarkers(content))
        : inferCitations(content, citations.map((c) => ({ n: c.n, text: c.text ?? c.snippet }))),
    [streaming, content, citations],
  );
  const segments = splitSegments(shown, { hadSources: citations.length > 0, known: citations.length });
  const renderCite = (n: number, inferred: boolean) => {
    const c = byN.get(n);
    return c ? <CiteChip citation={c} inferred={inferred} /> : null;
  };
  return (
    <div className="space-y-3">
      {segments.map((seg, i) =>
        seg.kind === "uncited" ? (
          <div key={i} className="relative pl-3" data-testid="uncited-block">
            <span aria-hidden className="absolute bottom-1 left-0 top-1 w-[2px] rounded-full bg-surface-3" />
            <Markdown text={seg.text} knownCitations={citations.length} renderCite={renderCite} />
            <p className="mt-0.5 text-[0.6875rem] text-faint">{s.chat.noSourceCited}</p>
          </div>
        ) : seg.kind === "general" ? (
          <div key={i} className="rounded-2xl border border-dashed border-border px-4 pb-3 pt-2" data-testid="general-block">
            <p className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-medium text-muted">
              <Globe2 size={12} /> {s.chat.notFromSources}
            </p>
            <Markdown text={seg.text} knownCitations={citations.length} renderCite={renderCite} />
          </div>
        ) : (
          <Markdown key={i} text={seg.text} knownCitations={citations.length} renderCite={renderCite} />
        ),
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  space,
  live,
  seconds,
  allLive,
}: {
  message: Message;
  space: Space;
  live?: { content: string; reasoning: string };
  seconds: Message[];
  allLive: Record<string, { content: string; reasoning: string }>;
}) {
  const content = live?.content ?? message.content;
  const reasoning = live?.reasoning ?? message.reasoning ?? "";
  const streaming = message.status === "streaming" && !!live;
  const citations = message.citations ?? [];
  const byN = new Map(citations.map((c) => [c.n, c]));
  const cited = citedNumbers(content, citations.length)
    .map((n) => byN.get(n))
    .filter((c): c is Citation => !!c);
  const [copied, setCopied] = useState(false);
  const interrupted = message.status === "streaming" && !live;


  return (
    <div className="group" data-testid="msg-assistant">
      {reasoning && <Thinking text={reasoning} active={streaming && !content} />}
      {streaming && !content && !reasoning && (
        <div className="flex items-center gap-2 py-1 text-sm text-muted">
          <Spinner size={14} /> {s.chat.thinking}…
        </div>
      )}
      <AnswerBody content={content} citations={citations} streaming={streaming} />
      {message.meta?.stopped && <p className="mt-2 text-xs text-faint">{s.chat.stopped}</p>}
      {(message.status === "error" || interrupted) && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{s.chat.failed}</p>
            <p className="break-words text-muted">{message.error ?? "The app closed while this answer was being written."}</p>
          </div>
          <RetryButton message={message} space={space} />
        </div>
      )}
      {message.meta?.retrievalError && (
        <p className="mt-2 text-xs text-warn">Source search failed for this answer: {message.meta.retrievalError}</p>
      )}
      {cited.length > 0 && !streaming && (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="cited-sources">
          {cited.map((c) => (
            <SourceButton key={c.n} citation={c} />
          ))}
        </div>
      )}
      {!streaming && content && (
        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            aria-label={s.common.copy}
            onClick={async () => {
              await navigator.clipboard.writeText(content.replaceAll("{{general}}", "").replaceAll("{{/general}}", ""));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <RetryButton message={message} space={space} subtle />
          <CheckButton message={message} space={space} />
          <SecondOpinionButton message={message} space={space} />
          {message.meta?.model && <span className="ml-1 text-[0.6875rem] text-faint">{message.meta.model.model}</span>}
        </div>
      )}
      <CheckResults message={message} />
      <RememberedChips message={message} />
      <SecondOpinions
        original={message}
        seconds={seconds}
        live={allLive}
        renderAnswer={(m, c) => <AnswerBody content={c} citations={m.citations ?? []} streaming={m.status === "streaming"} />}
      />
    </div>
  );
}

function Thinking({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2"
      >
        {active ? <Spinner size={13} /> : <Brain size={13} />}
        {active ? `${s.chat.thinking}…` : s.chat.thoughts}
        <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 text-xs leading-relaxed text-muted">
          {text}
        </div>
      )}
    </div>
  );
}

function CiteChip({ citation, inferred }: { citation: Citation; inferred: boolean }) {
  const openViewer = useUi((st) => st.openViewer);
  return (
    <Tooltip
      side="top"
      content={
        <span className="block max-w-xs">
          <span className="font-medium">
            {citation.sourceTitle}
            {citation.page != null ? ` · p. ${citation.page}` : ""}
          </span>
          <span className="mt-1 block opacity-80">{citation.snippet}</span>
          {inferred && <span className="mt-1 block opacity-70">{s.chat.inferredCitation}</span>}
        </span>
      }
    >
      <button
        data-testid="cite-chip"
        data-inferred={inferred || undefined}
        aria-label={`Citation ${citation.n}: ${citation.sourceTitle}${inferred ? " (matched by the app)" : ""}`}
        onClick={() => openViewer({ sourceId: citation.sourceId, start: citation.start, end: citation.end })}
        className={cn(
          "mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded-full px-1 align-middle text-[0.6875rem] font-semibold text-accent-text hover:bg-accent hover:text-on-accent",
          inferred ? "border border-dashed border-accent-text/60" : "bg-accent-soft",
        )}
      >
        {citation.n}
      </button>
    </Tooltip>
  );
}

function SourceButton({ citation }: { citation: Citation }) {
  const openViewer = useUi((st) => st.openViewer);
  return (
    <button
      onClick={() => openViewer({ sourceId: citation.sourceId, start: citation.start, end: citation.end })}
      title={citation.snippet}
      className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
    >
      <span className="font-semibold text-accent-text">{citation.n}</span>
      <span className="truncate">{citation.sourceTitle}</span>
      {citation.page != null && <span className="shrink-0 text-faint">p. {citation.page}</span>}
    </button>
  );
}

function RetryButton({ message, space, subtle }: { message: Message; space: Space; subtle?: boolean }) {
  const [busy, setBusy] = useState(false);
  const navigate = useUi((st) => st.navigate);
  const retry = async () => {
    setBusy(true);
    try {
      const all = await api.listMessages(message.threadId);
      const idx = all.findIndex((m) => m.id === message.id);
      const prevUser = [...all.slice(0, idx)].reverse().find((m) => m.role === "user");
      const seconds = all.slice(idx + 1).filter((m) => m.meta?.secondOpinionOf === message.id);
      const after = all.slice(idx + 1).filter((m) => m.meta?.secondOpinionOf !== message.id);
      if (after.length) {
        toast.info("Only the latest answer can be regenerated.");
        return;
      }
      for (const m of seconds) await api.deleteMessage(m.id);
      await api.deleteMessage(message.id);
      queryClient.invalidateQueries({ queryKey: qk.messages(message.threadId) });
      await runTurn({
        space,
        threadId: message.threadId,
        tutorStyle: space.tutorStyle,
        thinking: useUi.getState().thinking,
        focus: useFocusStore.getState().state,
        userText: prevUser?.content,
        query: prevUser?.content,
        persistUser: false,
      });
    } catch (e) {
      if (e instanceof NoModelError) {
        toast.error(s.chat.noModel, { action: { label: s.chat.noModelAction, onClick: () => navigate({ name: "settings" }) } });
      } else toastError(s.chat.failed, e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      aria-label={s.common.retry}
      disabled={busy}
      onClick={retry}
      className={cn(
        "inline-flex items-center gap-1 rounded-full text-xs font-medium",
        subtle ? "p-1.5 text-muted hover:bg-surface-2 hover:text-fg" : "shrink-0 bg-surface px-3 py-1.5 hover:bg-surface-2",
      )}
    >
      <RotateCcw size={subtle ? 15 : 13} /> {!subtle && s.common.retry}
    </button>
  );
}
