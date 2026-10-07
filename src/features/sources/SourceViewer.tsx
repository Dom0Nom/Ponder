import { useEffect, useMemo, useRef, useState } from "react";
import { useAddCard } from "../cards/FlashcardsCard";
import { clozeFromSelection } from "../../lib/srs/cloze";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bold, BookOpenCheck, ExternalLink, Layers, ScanLine } from "lucide-react";
import { useFocusPrefs, useSetFocusPref } from "../../lib/focusPrefs";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { buildPieces } from "../../lib/sources/pieces";
import { useUi } from "../../stores/ui";
import { ErrorState, Skeleton, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { detectChapters } from "../../lib/placement/logic";
import type { Source } from "../../lib/types";
import { BionicText } from "./BionicText";
import { ReadingRuler } from "./ReadingRuler";

export function SourceViewer({ target }: { target: { sourceId: string; start?: number; end?: number } }) {
  const openViewer = useUi((st) => st.openViewer);
  const source = useQuery({ queryKey: ["source", target.sourceId], queryFn: () => api.getSource(target.sourceId) });
  const text = useQuery({ queryKey: qk.sourceText(target.sourceId), queryFn: () => api.getSourceText(target.sourceId) });
  const markRef = useRef<HTMLElement>(null);

  const pieces = useMemo(() => (text.data ? buildPieces(text.data, target.start, target.end) : []), [text.data, target.start, target.end]);

  useEffect(() => {
    if (markRef.current) markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pieces]);

  const { prefs } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const reading = prefs.reading;
  const toggleReading = (key: "bionic" | "ruler") =>
    setPref("reading", { ...reading, [key]: !reading[key] }).catch((e) => toastError(s.reading.saveFailed, e));
  let firstMark = true;

  return (
    <div
      className="flex h-full flex-col"
      data-testid="source-viewer"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) openViewer(null);
      }}
    >
      <div className="flex items-center gap-2 border-b border-divider px-3 py-2">
        <button
          aria-label={s.common.back}
          onClick={() => openViewer(null)}
          className="flex size-7 items-center justify-center rounded-btn text-fg hover:bg-fill"
        >
          <ArrowLeft size={15} />
        </button>
        <p className="min-w-0 flex-1 truncate text-input font-semibold">{source.data?.title ?? s.sources.viewerLoading}</p>
        <div role="group" aria-label={s.reading.toolbarGroup} className="flex items-center gap-0.5">
          {(
            [
              ["bionic", s.reading.bionic, Bold],
              ["ruler", s.reading.ruler, ScanLine],
            ] as const
          ).map(([key, label, Glyph]) => (
            <button
              key={key}
              aria-pressed={reading[key]}
              onClick={() => toggleReading(key)}
              className="flex h-7.5 items-center gap-1.5 rounded-btn px-[9px] font-medium hover:bg-fill aria-pressed:bg-fill-active aria-pressed:font-semibold"
            >
              <Glyph size={14} /> {label}
            </button>
          ))}
        </div>
        {source.data && text.data && <MakeCourseButton source={source.data} text={text.data.text} />}
        {source.data?.origin && /^https?:/.test(source.data.origin) && (
          <Tooltip content={s.sources.openOriginal}>
            <a
              href={source.data.origin}
              target="_blank"
              rel="noreferrer"
              aria-label={s.sources.openOriginal}
              className="flex size-7 items-center justify-center rounded-btn text-fg hover:bg-fill"
            >
              <ExternalLink size={15} />
            </a>
          </Tooltip>
        )}
      </div>
      <ReadingRuler enabled={reading.ruler}>
      <div className="h-full overflow-y-auto">
        {(source.isLoading || text.isLoading) && (
          <div className="mx-auto max-w-[680px] space-y-3 px-10 py-9">
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
          <div className="mx-auto flex max-w-[680px] flex-col gap-4 px-10 py-9 text-base leading-[1.75]">
            <div className="flex flex-col gap-1 rounded-card border border-border px-3.5 py-3">
              <p className="text-label font-semibold leading-[1.45] text-muted">{s.sources.summary}</p>
              <p className="text-[0.84375rem] leading-[1.55] text-fg-secondary">{source.data.summary ?? s.sources.noSummary}</p>
            </div>
            <SelectionToCard source={source.data} text={text.data.text} />
            <div className="whitespace-pre-wrap break-words" data-testid="source-text">
              {pieces.map((p, i) => (
                <span key={i}>
                  {p.page != null && (
                    <span className="mb-2 mt-4 block select-none text-label font-semibold leading-[1.45] text-muted">
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
                      {reading.bionic ? <BionicText text={p.text} /> : p.text}
                    </mark>
                  ) : reading.bionic ? (
                    <BionicText text={p.text} />
                  ) : (
                    p.text
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      </ReadingRuler>
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
      <button onClick={make} className="flex h-7.5 items-center gap-1.5 rounded-btn px-[9px] font-medium hover:bg-fill">
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
      setSel({ text: str, top: rect.top - 38, left: rect.left + rect.width / 2 });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);
  if (!sel) return null;
  return (
    <button
      style={{ position: "fixed", top: Math.max(8, sel.top), left: sel.left, transform: "translateX(-50%)" }}
      className="z-40 inline-flex h-7.5 items-center gap-1.5 rounded-control bg-primary px-2.5 text-[0.78125rem] font-semibold text-on-primary shadow-float"
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
