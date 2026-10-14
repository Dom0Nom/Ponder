import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Copy, FileText, Layers, Library, PencilLine } from "lucide-react";
import { NoModelError } from "../../lib/chat/llm";
import { citedNumbers } from "../../lib/chat/citations";
import { plainAnswer } from "../../lib/chat/plainAnswer";
import { useMessages, useSources, useThreads } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Citation, Message, Space } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { PonderMark } from "../../components/brand/PonderMark";
import { toastError } from "../../components/ui/toast";
import { useAddCard } from "../cards/FlashcardsCard";
import { useLowEnergy } from "../focus/useLowEnergy";
import { KIND_ICON } from "../sources/kinds";
import { ListenButton } from "../speech/ListenButton";
import { ActionTipGroup } from "./ActionTipGroup";
import { CheckButton, SecondOpinionButton } from "./AnswerTools";
import { actionIconBtn, actionTextBtn } from "./actionButton";
import { RetryButton } from "./RetryButton";
import { startInlinePractice } from "./startPractice";

function SourcesPopover({ citations, spaceId }: { citations: Citation[]; spaceId: string }) {
  const sources = useSources(spaceId);
  const openViewer = useUi((st) => st.openViewer);
  const [open, setOpen] = useState(false);
  const kinds = new Map((sources.data ?? []).map((x) => [x.id, x.kind]));
  const count = new Set(citations.map((c) => c.sourceId)).size;
  if (!count) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className={`${actionTextBtn} ms-auto text-fg-secondary`}>
          <Library size={13} /> {s.chat.sourcesCount(count)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          data-testid="cited-sources"
          className="t-dropdown z-50 w-[300px] rounded-pane border border-border bg-surface p-1 text-body text-fg shadow-menu outline-none"
        >
          {citations.map((c) => {
            const Icon = KIND_ICON[kinds.get(c.sourceId) ?? "pdf"] ?? FileText;
            return (
              <button
                key={c.n}
                title={c.snippet}
                onClick={() => {
                  openViewer({ sourceId: c.sourceId, start: c.start, end: c.end });
                  setOpen(false);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-item px-2 text-start hover:bg-fill"
              >
                <Icon size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{c.sourceTitle}</span>
                {c.page != null && <span className="shrink-0 text-muted">{s.chat.pageShort(c.page)}</span>}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AnswerActions({ message, space, content }: { message: Message; space: Space; content: string }) {
  const [copied, setCopied] = useState(false);
  const [quizzing, setQuizzing] = useState(false);
  const low = useLowEnergy(space.id);
  const openCard = useAddCard((st) => st.open);
  const messages = useMessages(message.threadId);
  const threads = useThreads(space.id);
  const citations = message.citations ?? [];
  const cited = citedNumbers(content, citations.length)
    .map((n) => citations.find((c) => c.n === n))
    .filter((c): c is Citation => !!c);

  const prevUserText = () => {
    const all = messages.data ?? [];
    const idx = all.findIndex((m) => m.id === message.id);
    return [...all.slice(0, idx)].reverse().find((m) => m.role === "user")?.content ?? "";
  };

  const makeCard = () =>
    openCard({
      spaceId: space.id,
      kind: "basic",
      front: prevUserText(),
      back: plainAnswer(content).slice(0, 600),
      sourceId: cited[0]?.sourceId ?? null,
      chunkStart: cited[0]?.start ?? null,
      chunkEnd: cited[0]?.end ?? null,
    });

  const quiz = async () => {
    setQuizzing(true);
    try {
      await startInlinePractice({
        space,
        answer: message,
        question: prevUserText(),
        threadTitle: threads.data?.find((t) => t.id === message.threadId)?.title ?? "",
      });
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.practice.startFailed, e);
    } finally {
      setQuizzing(false);
    }
  };

  return (
    <div className="-ms-1.5 flex items-center gap-0.5 text-caption" data-testid="answer-actions">
      <ActionTipGroup className="gap-0.5">
        <button
          aria-label={s.common.copy}
          data-tip-name={s.common.copy}
          data-tip-desc={s.chat.copyDesc}
          className={actionIconBtn}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(plainAnswer(content));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch (e) {
              toastError(s.chat.copyFailed, e);
            }
          }}
        >
          <span className="t-icon-swap" data-state={copied ? "b" : "a"}>
            <Copy size={14} data-icon="a" className="t-icon" />
            <Check size={14} data-icon="b" className="t-icon" />
          </span>
        </button>
        <ListenButton id={`msg-${message.id}`} text={() => plainAnswer(content)} className={actionIconBtn} />
        <CheckButton message={message} space={space} />
        <SecondOpinionButton message={message} space={space} />
        <RetryButton message={message} space={space} subtle />
      </ActionTipGroup>
      <span aria-hidden className="mx-1.5 h-3.5 w-px bg-border" />
      <button className={actionTextBtn} onClick={makeCard}>
        <Layers size={13} /> {s.chat.makeCard}
      </button>
      <button className={actionTextBtn} disabled={low.active || quizzing} title={low.reason} onClick={quiz}>
        {quizzing ? <PonderMark size={20} state="generating" /> : <PencilLine size={13} />} {s.chat.quizMe}
      </button>
      <SourcesPopover citations={cited} spaceId={space.id} />
    </div>
  );
}
