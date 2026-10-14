import { lazy, useMemo, useState } from "react";
import { Fx } from "../../components/fx/Fx";
import { AlertCircle, Brain, ChevronRight, FileText, Globe2, Timer } from "lucide-react";
const BuddyAvatar = lazy(() => import("../../components/fx/BuddyAvatar"));
import { splitSegments, inferCitations } from "../../lib/chat/citations";
import { stripMarkers } from "../../lib/chat/followUps";
import { thoughtLabel, thoughtSeconds } from "../../lib/chat/thinking";
import { useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Citation, Message, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useComposer } from "../../stores/composer";
import { Tooltip } from "../../components/ui/misc";
import { Reveal } from "../../components/motion/Reveal";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { PonderMark } from "../../components/brand/PonderMark";
import { KIND_ICON } from "../sources/kinds";
import { CheckResults, RememberedChips, SecondOpinions, ToolChips } from "./AnswerTools";
import { AnswerActions } from "./AnswerActions";
import { FollowUps } from "./FollowUps";
import { InlinePractice } from "./InlinePractice";
import { Markdown } from "./Markdown";
import { ReasoningPeek } from "./ReasoningPeek";
import { RetryButton } from "./RetryButton";
import { ThinkingLine } from "../../components/motion/ThinkingLine";

export function MessageView({
  message,
  space,
  live,
  seconds = [],
  allLive = {},
  latest = false,
}: {
  message: Message;
  space: Space;
  live?: { content: string; reasoning: string };
  seconds?: Message[];
  allLive?: Record<string, { content: string; reasoning: string }>;
  /** the newest answer in the thread, the only one that offers follow-ups */
  latest?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-testid="msg-user">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-pane bg-fill px-3.5 py-2.5 text-input leading-[1.45]">{message.content}</div>
      </div>
    );
  }
  if (message.role === "buddy") {
    return (
      <Reveal className="flex justify-center" data-testid="msg-buddy">
        <span className="inline-flex items-center gap-2 rounded-full bg-fill px-3.5 py-1.5 text-label font-medium text-fg-secondary">
          <Fx fallback={<Timer size={13} />} render={() => <BuddyAvatar size={20} />} /> {message.content}
        </span>
      </Reveal>
    );
  }
  if (message.role === "practice") return <InlinePractice message={message} space={space} />;
  if (message.role === "system") return null;
  return <AssistantMessage message={message} space={space} live={live} seconds={seconds} allLive={allLive} latest={latest} />;
}

/** Answer text with general/uncited segments and citation chips. */
export function AnswerBody({
  content,
  citations,
  streaming,
  spaceId,
  onOpenCitation,
}: {
  content: string;
  citations: Citation[];
  streaming: boolean;
  spaceId?: string;
  /** replaces the default "open in the source viewer" (the ask overlay has no viewer) */
  onOpenCitation?: (c: Citation) => void;
}) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const shown = useMemo(
    () =>
      streaming
        ? stripMarkers(content)
        : inferCitations(stripMarkers(content), citations.map((c) => ({ n: c.n, text: c.text ?? c.snippet }))),
    [streaming, content, citations],
  );
  const segments = splitSegments(shown, { hadSources: citations.length > 0, known: citations.length });
  const renderCite = (ns: number[], inferred: boolean) => {
    const cs = ns.map((n) => byN.get(n)).filter((c): c is Citation => !!c);
    return cs.length ? <CiteChip citations={cs} inferred={inferred} spaceId={spaceId} onOpen={onOpenCitation} /> : null;
  };
  return (
    <div className="flex flex-col gap-2.5">
      {segments.map((seg, i) =>
        seg.kind === "uncited" ? (
          <div key={i} className="relative ps-3" data-testid="uncited-block">
            <span aria-hidden className="absolute bottom-1 start-0 top-1 w-[2px] rounded-full bg-border" />
            <Markdown text={seg.text} knownCitations={citations.length} renderCite={renderCite} streaming={streaming} />
            <p className="mt-0.5 text-kbd text-muted">{s.chat.noSourceCited}</p>
          </div>
        ) : seg.kind === "general" ? (
          <div key={i} className="rounded-pane border border-dashed border-control-off px-3.5 pb-3 pt-2" data-testid="general-block">
            <p className="mb-1 flex items-center gap-1.5 text-kbd font-medium text-muted">
              <Globe2 size={12} /> {s.chat.notFromSources}
            </p>
            <Markdown text={seg.text} knownCitations={citations.length} renderCite={renderCite} streaming={streaming} />
          </div>
        ) : (
          <Markdown key={i} text={seg.text} knownCitations={citations.length} renderCite={renderCite} streaming={streaming} />
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
  latest,
}: {
  message: Message;
  space: Space;
  live?: { content: string; reasoning: string };
  seconds: Message[];
  allLive: Record<string, { content: string; reasoning: string }>;
  latest: boolean;
}) {
  const content = live?.content ?? message.content;
  const reasoning = live?.reasoning ?? message.reasoning ?? "";
  const streaming = message.status === "streaming" && !!live;
  const citations = message.citations ?? [];
  const interrupted = message.status === "streaming" && !live;
  const sendText = useComposer((st) => st.sendText);
  const followUps = message.meta?.followUps;

  return (
    <div className="flex flex-col gap-2.5 text-input leading-[1.65]" data-testid="msg-assistant">
      {reasoning && <Thinking text={reasoning} active={streaming && !content} ms={message.meta?.thinkingMs} />}
      {streaming && !content && !reasoning && (
        <GeneratingStatus think label={`${s.chat.thinking}…`} />
      )}
      <AnswerBody content={content} citations={citations} streaming={streaming} spaceId={space.id} />
      {streaming && content && <GeneratingStatus label={`${s.chat.writing}…`} />}
      {message.meta?.stopped && <p className="text-xs text-faint">{s.chat.stopped}</p>}
      {(message.status === "error" || interrupted) && (
        <Reveal role="alert" className="flex items-start gap-2 rounded-pane bg-danger-hover px-4 py-3 text-body leading-[1.45]">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{s.chat.failed}</p>
            <p className="break-words text-muted">{message.error ?? s.chat.interrupted}</p>
          </div>
          <RetryButton message={message} space={space} />
        </Reveal>
      )}
      {message.meta?.retrievalError && <p className="text-xs text-warn">{s.chat.sourceSearchFailed(message.meta.retrievalError)}</p>}
      {!streaming && content && <AnswerActions message={message} space={space} content={content} />}
      {!streaming && latest && followUps?.length && sendText ? <FollowUps items={followUps} onAsk={sendText} /> : null}
      <CheckResults message={message} />
      <ToolChips message={message} />
      <RememberedChips message={message} />
      <SecondOpinions
        original={message}
        seconds={seconds}
        live={allLive}
        renderAnswer={(m, c) => <AnswerBody content={c} citations={m.citations ?? []} streaming={m.status === "streaming"} spaceId={space.id} />}
      />
    </div>
  );
}

function Thinking({ text, active, ms }: { text: string; active: boolean; ms?: number }) {
  const [open, setOpen] = useState(false);
  const label = active ? `${s.chat.thinking}…` : ms ? thoughtLabel(thoughtSeconds(ms)) : s.chat.thoughts;
  return (
    <div className="t-acc t-acc--noblur flex flex-col" data-open={open}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group/think inline-flex h-[21.45px] items-center gap-1.5 self-start text-label font-medium leading-[1.65] text-fg-secondary hover:text-fg"
      >
        {active ? <PonderMark size={20} state="generating" /> : <Brain size={13} />}
        <ThinkingLine label={label} shimmer={active} />
        <span className={cn("t-acc-chevron t-acc-chevron--right opacity-0 transition-opacity group-hover/think:opacity-100 group-focus-visible/think:opacity-100", open && "opacity-100")}>
          <ChevronRight size={12} />
        </span>
      </button>
      {active && !open && text && <ReasoningPeek text={text} />}
      <div className="t-acc-panel" inert={!open}>
        <div className="t-acc-panel-inner">
          <div className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap border-s-2 border-border ps-3 text-label leading-relaxed text-muted">{text}</div>
        </div>
      </div>
    </div>
  );
}

function CiteChip({ citations, inferred, spaceId, onOpen }: { citations: Citation[]; inferred: boolean; spaceId?: string; onOpen?: (c: Citation) => void }) {
  const openViewer = useUi((st) => st.openViewer);
  const sources = useSources(spaceId ?? "");
  const first = citations[0];
  const ids = [...new Set(citations.map((c) => c.sourceId))];
  const titles = ids.map((id) => citations.find((c) => c.sourceId === id)!.sourceTitle);
  const extra = ids.length - 1;
  const kind = sources.data?.find((x) => x.id === first.sourceId)?.kind;
  const Icon = (kind && KIND_ICON[kind]) || FileText;
  return (
    <Tooltip
      side="top"
      content={
        <span className="block max-w-xs">
          {citations.map((c) => (
            <span key={c.n} className="mb-1 block last:mb-0">
              <span className="font-medium">
                {c.sourceTitle}
                {c.page != null ? ` · ${s.chat.pageShort(c.page)}` : ""}
              </span>
              <span className="mt-0.5 block opacity-80">{c.snippet}</span>
            </span>
          ))}
          {inferred && <span className="mt-1 block opacity-70">{s.chat.inferredCitation}</span>}
        </span>
      }
    >
      <button
        data-testid="cite-chip"
        data-inferred={inferred || undefined}
        aria-label={s.chat.citation(titles.join(", "))}
        onClick={() => (onOpen ? onOpen(first) : openViewer({ sourceId: first.sourceId, start: first.start, end: first.end }))}
        className={cn(
          "ms-1 inline-flex h-5 max-w-[220px] items-center transition-colors duration-(--motion-quick) gap-[5px] whitespace-nowrap rounded-full ps-[3px] pe-2 align-[1px] text-label font-medium leading-none text-fg",
          inferred ? "border border-dashed border-control-off" : "bg-chip hover:bg-fill-active",
        )}
      >
        <Icon size={12} className="ms-[3px] shrink-0" />
        <span className="truncate">{titles[0]}</span>
        {extra > 0 && <span className="text-muted">+{extra}</span>}
      </button>
    </Tooltip>
  );
}
