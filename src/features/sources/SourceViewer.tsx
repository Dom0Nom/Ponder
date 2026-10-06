import { useEffect, useMemo, useRef, useState } from "react";
import { useAddCard } from "../cards/FlashcardsCard";
import { clozeFromSelection } from "../../lib/srs/cloze";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpenCheck, ExternalLink, Layers } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { buildPieces } from "../../lib/sources/pieces";
import { useUi } from "../../stores/ui";
import { ErrorState, Skeleton, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { detectChapters } from "../../lib/placement/logic";
import type { Source } from "../../lib/types";
import { KIND_ICON } from "./SourcesPane";

export function SourceViewer({ target }: { target: { sourceId: string; start?: number; end?: number } }) {
  const openViewer = useUi((st) => st.openViewer);
  const source = useQuery({ queryKey: ["source", target.sourceId], queryFn: () => api.getSource(target.sourceId) });
  const text = useQuery({ queryKey: qk.sourceText(target.sourceId), queryFn: () => api.getSourceText(target.sourceId) });
  const markRef = useRef<HTMLElement>(null);

  const pieces = useMemo(() => (text.data ? buildPieces(text.data, target.start, target.end) : []), [text.data, target.start, target.end]);

  useEffect(() => {
    if (markRef.current) markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pieces]);

  const Icon = source.data ? KIND_ICON[source.data.kind] : null;
  let firstMark = true;

  return (
    <div className="flex h-full flex-col" data-testid="source-viewer">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          aria-label={s.common.back}
          onClick={() => openViewer(null)}
          className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ArrowLeft size={17} />
        </button>
        {Icon && <Icon size={16} className="shrink-0 text-muted" />}
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{source.data?.title ?? s.sources.viewerLoading}</p>
        {source.data && text.data && <MakeCourseButton source={source.data} text={text.data.text} />}
        {source.data?.origin && /^https?:/.test(source.data.origin) && (
          <a
            href={source.data.origin}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original"
            className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ExternalLink size={15} />
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(source.isLoading || text.isLoading) && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-16" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        )}
        {(source.error || text.error) && (
          <ErrorState
            title="Couldn't open this source"
            error={source.error ?? text.error}
            onRetry={() => {
              source.refetch();
              text.refetch();
            }}
          />
        )}
        {source.data && text.data && (
          <div className="px-5 py-4">
            <div className="mb-5 rounded-2xl bg-surface-2 px-4 py-3">
              <p className="text-xs font-medium text-muted">{s.sources.summary}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed">{source.data.summary ?? s.sources.noSummary}</p>
            </div>
            <SelectionToCard source={source.data} text={text.data.text} />
            <div className="whitespace-pre-wrap break-words text-[0.875rem] leading-[1.75]" data-testid="source-text">
              {pieces.map((p, i) => (
                <span key={i}>
                  {p.page != null && (
                    <span className="my-3 block select-none border-t border-border pt-2 text-[0.6875rem] font-medium text-faint">
                      {s.sources.page(p.page)}
                    </span>
                  )}
                  {p.mark ? (
                    <mark
                      className="cite-highlight"
                      data-testid="cite-highlight"
                      ref={(() => {
                        const isFirst = firstMark;
                        firstMark = false;
                        return isFirst ? markRef : undefined;
                      })()}
                    >
                      {p.text}
                    </mark>
                  ) : (
                    p.text
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MakeCourseButton({ source, text }: { source: Source; text: string }) {
  const qc = useQueryClient();
  const chapters = useMemo(() => detectChapters(text), [text]);
  if (chapters.length < 2) return null;
  const make = async () => {
    try {
      const course = await api.courseCreate(
        source.spaceId,
        source.id,
        source.title,
        chapters.map((c) => ({ title: c.title, startOffset: c.start, endOffset: c.end })),
      );
      qc.invalidateQueries({ queryKey: qk.courses(source.spaceId) });
      toast.success(s.course.created(course.lessons.length));
    } catch (e) {
      toastError(s.errors.generic, e, make);
    }
  };
  return (
    <Tooltip content={s.course.makeHelp}>
      <button onClick={make} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-accent-text hover:bg-accent-soft">
        <BookOpenCheck size={14} /> {s.course.make}
      </button>
    </Tooltip>
  );
}

/** Floating "Make card" button for text selected in the viewer. */
function SelectionToCard({ source, text }: { source: Source; text: string }) {
  const [sel, setSel] = useState<{ text: string; top: number; left: number } | null>(null);
  const openAdd = useAddCard((st) => st.open);
  useEffect(() => {
    const onUp = () => {
      const s2 = window.getSelection();
      const str = s2?.toString().trim() ?? "";
      const container = document.querySelector('[data-testid="source-text"]');
      if (!s2 || !str || str.length < 2 || str.length > 300 || !container || !s2.anchorNode || !container.contains(s2.anchorNode)) {
        setSel(null);
        return;
      }
      const rect = s2.getRangeAt(0).getBoundingClientRect();
      setSel({ text: str, top: rect.top - 40, left: rect.left + rect.width / 2 });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);
  if (!sel) return null;
  return (
    <button
      style={{ position: "fixed", top: Math.max(8, sel.top), left: sel.left, transform: "translateX(-50%)" }}
      className="z-40 inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const i = text.indexOf(sel.text);
        const start = i === -1 ? 0 : i;
        const end = i === -1 ? 0 : i + sel.text.length;
        openAdd({
          spaceId: source.spaceId,
          kind: "cloze",
          front: i === -1 ? `{{c1::${sel.text}}}` : clozeFromSelection(text, start, end),
          sourceId: source.id,
          chunkStart: i === -1 ? null : start,
          chunkEnd: i === -1 ? null : end,
        });
        window.getSelection()?.removeAllRanges();
        setSel(null);
      }}
    >
      <Layers size={13} /> {s.cards.makeFromSelection}
    </button>
  );
}
