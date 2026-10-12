import { ListenButton } from "../speech/ListenButton";
import { Reveal } from "../../components/motion/Reveal";
import { motionReduced } from "../../app/useTheme";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAddCard } from "../cards/FlashcardsCard";
import { clozeFromSelection } from "../../lib/srs/cloze";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bold, BookOpenCheck, ExternalLink, FileText, Highlighter, Layers, MonitorPlay, NotebookPen, ScanLine, SlidersHorizontal } from "lucide-react";
import { useFocusPrefs, useSetFocusPref } from "../../lib/focusPrefs";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { buildPieces } from "../../lib/sources/pieces";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { ErrorState, Skeleton, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { detectChapters } from "../../lib/placement/logic";
import type { Source, SourceText } from "../../lib/types";
import { pdfSelectionOffsets } from "./pdfSelection";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { BionicText } from "./BionicText";
import { useSummarizing } from "./useAutoSummaries";
import { ReadingRuler } from "./ReadingRuler";
import { PassageList, ReadingControls } from "./ReadingTools";
import { WatchAlong } from "./WatchAlong";
import { HighlightList, HighlightMark, selectionOffsets, useAddHighlight, useAnnotations, type Anchored } from "./Highlights";
import { GlossaryPanel } from "../notes/GlossaryPanel";
import { useSpace } from "../../lib/queries";
import type { ReadingLevel } from "../../lib/notes/passages";

const PdfPages = lazy(() => import("./PdfPages"));

export function SourceViewer({ target }: { target: { sourceId: string; start?: number; end?: number } }) {
  const openViewer = useUi((st) => st.openViewer);
  const navigate = useUi((st) => st.navigate);
  const source = useQuery({ queryKey: ["source", target.sourceId], queryFn: () => api.getSource(target.sourceId) });
  const text = useQuery({ queryKey: qk.sourceText(target.sourceId), queryFn: () => api.getSourceText(target.sourceId) });
  const summarizing = useSummarizing((st) => !!st.ids[target.sourceId]);
  const markRef = useRef<HTMLElement>(null);
  const space = useSpace(source.data?.spaceId ?? "");
  const [level, setLevel] = useState<ReadingLevel>("original");
  const [lang, setLang] = useState<string | null>(null);
  const [tools, setTools] = useState(false);
  const [watching, setWatching] = useState(false);
  const [paged, setPaged] = useState(false);
  const showPages = paged && source.data?.kind === "pdf";
  const rewritten = !showPages && (level !== "original" || !!lang);

  const annots = useAnnotations(target.sourceId, text.data?.text);
  const placed = useMemo(() => annots.anchored.filter((a) => !a.detached), [annots.anchored]);
  const byId = useMemo(() => new Map<string, Anchored>(placed.map((a) => [a.id, a])), [placed]);
  const pieces = useMemo(
    () => (text.data ? buildPieces(text.data, target.start, target.end, placed) : []),
    [text.data, target.start, target.end, placed],
  );

  useEffect(() => {
    if (markRef.current) markRef.current.scrollIntoView({ block: "center", behavior: motionReduced() ? "auto" : "smooth" });
  }, [pieces]);

  const { prefs } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const reading = prefs.reading;
  const toggleReading = (key: "bionic" | "ruler") =>
    setPref("reading", { ...reading, [key]: !reading[key] }).catch((e) => toastError(s.reading.saveFailed, e));
  let firstMark = true;

  return (
    <div
      className="group/viewer relative flex h-full flex-col"
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
        {source.data && text.data && (
          <ListenButton id={`source-${source.data.id}`} text={text.data.text} className="flex size-7 items-center justify-center gap-1.5 rounded-btn text-fg hover:bg-fill" />
        )}
        {source.data?.kind === "pdf" && text.data && (
          <Tooltip content={s.pdfView.toggleHelp}>
            <button
              aria-pressed={paged}
              onClick={() => setPaged((p) => !p)}
              className="flex h-7.5 items-center gap-1.5 rounded-btn px-[9px] font-medium hover:bg-fill aria-pressed:bg-fill-active aria-pressed:font-semibold"
            >
              <FileText size={14} /> {s.pdfView.toggle}
            </button>
          </Tooltip>
        )}
        {source.data?.kind === "youtube" && text.data && (
          <button
            aria-pressed={watching}
            onClick={() => setWatching((w) => !w)}
            className="flex h-7.5 items-center gap-1.5 rounded-btn px-[9px] font-medium hover:bg-fill aria-pressed:bg-fill-active aria-pressed:font-semibold"
          >
            <MonitorPlay size={14} /> {s.watchAlong.open}
          </button>
        )}
        {source.data?.origin?.startsWith("note:") && (
          <button
            onClick={() => navigate({ name: "notes", spaceId: source.data!.spaceId, noteId: source.data!.origin!.slice(5) })}
            className="flex h-7.5 items-center gap-1.5 rounded-btn px-[9px] font-medium hover:bg-fill"
          >
            <NotebookPen size={14} /> {s.notes.openNote}
          </button>
        )}
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
      <button
        aria-expanded={tools}
        onClick={() => setTools((t) => !t)}
        data-testid="reading-tools-toggle"
        className={cn(
          "absolute right-4 top-14 z-10 flex h-7.5 items-center gap-1.5 rounded-btn border border-border bg-surface px-2.5 font-medium shadow-float transition-opacity hover:bg-fill focus-visible:opacity-100 group-hover/viewer:opacity-100",
          !tools && "opacity-0",
        )}
      >
        <SlidersHorizontal size={14} /> {s.readingTools.toggle}
      </button>
      <ReadingRuler enabled={reading.ruler}>
      <div className="h-full overflow-y-auto">
        {(source.isLoading || text.isLoading) && (
          <div className="mx-auto max-w-[760px] space-y-3 px-10 py-9">
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
          <div className={cn("mx-auto flex flex-col gap-4 px-10 py-9 text-base leading-[1.75]", lang ? "max-w-[1100px]" : "max-w-[760px]")}>
            <div className="flex flex-col gap-1 rounded-card border border-border px-3.5 py-3">
              <p className="text-label font-semibold leading-[1.75] text-muted">{s.sources.summary}</p>
              {!source.data.summary && summarizing ? (
                <GeneratingStatus label={s.sources.summarizing} className="text-muted" />
              ) : (
                <p className="text-[0.84375rem] leading-[1.55] text-fg-secondary">{source.data.summary ?? s.sources.noSummary}</p>
              )}
            </div>
            {watching && source.data.kind === "youtube" && (
              <div className="leading-normal">
                <WatchAlong source={source.data} text={text.data.text} space={space.data} />
              </div>
            )}
            {tools && (
              <div className="flex flex-col gap-4 leading-normal" data-testid="reading-tools-panel">
                <ReadingControls level={level} lang={lang} onLevel={setLevel} onLang={setLang} />
                <HighlightList anchored={annots.anchored} error={annots.q.error} onRetry={() => annots.q.refetch()} />
                <GlossaryPanel subjectId={source.data.id} text={text.data.text} space={space.data} />
              </div>
            )}
            {!rewritten && <SelectionActions source={source.data} st={text.data} paged={showPages} />}
            {showPages ? (
              <Suspense fallback={<Skeleton className="mx-auto aspect-[1/1.41] w-full max-w-[900px]" />}>
                <PdfPages sourceId={source.data.id} st={text.data} annots={placed} onShowText={() => setPaged(false)} />
              </Suspense>
            ) : rewritten ? (
              <PassageList sourceId={source.data.id} text={text.data.text} space={space.data} level={level} lang={lang} />
            ) : (
            <div className="whitespace-pre-wrap break-words" data-testid="source-text">
              {pieces.map((p, i) => {
                const body = p.annot && byId.has(p.annot) ? (
                  <HighlightMark annot={byId.get(p.annot)!}>
                    <Paragraphs text={p.text} base={p.start} bionic={reading.bionic} />
                  </HighlightMark>
                ) : (
                  <Paragraphs text={p.text} base={p.start} bionic={reading.bionic} />
                );
                return (
                <span key={i}>
                  {p.page != null && (
                    <span className="mb-4 mt-4 block select-none text-label font-semibold leading-[1.75] text-muted [div>span:first-child>&]:mt-0">
                      {s.sources.page(p.page)}
                    </span>
                  )}
                  {p.mark ? (
                    <mark
                      className={cn(
                        "cite-highlight",
                        (i === 0 || pieces[i - 1].text.endsWith("\n\n")) && (i === pieces.length - 1 || pieces[i + 1].text.startsWith("\n\n")) && "block",
                      )}
                      data-testid="cite-highlight"
                      ref={(() => {
                        const isFirst = firstMark;
                        firstMark = false;
                        return isFirst ? markRef : undefined;
                      })()}
                    >
                      {body}
                    </mark>
                  ) : (
                    body
                  )}
                </span>
                );
              })}
            </div>
            )}
          </div>
        )}
      </div>
      </ReadingRuler>
    </div>
  );
}

/** Blank lines become a 16px gap, like separate paragraphs in the design. */
function Paragraphs({ text, base, bionic }: { text: string; base: number; bionic: boolean }) {
  const segs: [string, number][] = [];
  let last = 0;
  for (const m of text.matchAll(/\n{2,}/g)) {
    segs.push([text.slice(last, m.index), last]);
    last = m.index + m[0].length;
  }
  segs.push([text.slice(last), last]);
  return (
    <>
      {segs.map(([seg, off], i) => (
        <span key={i} data-off={base + off}>
          {i > 0 && <span aria-hidden className="block h-4" />}
          {bionic ? <BionicText text={seg} /> : seg}
        </span>
      ))}
    </>
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

/** Floating "Make card" and "Highlight" buttons for text selected in the viewer. */
function SelectionActions({ source, st, paged }: { source: Source; st: SourceText; paged: boolean }) {
  const text = st.text;
  const [sel, setSel] = useState<{ start: number; end: number; top: number; left: number } | null>(null);
  const openAdd = useAddCard((st) => st.open);
  const addHighlight = useAddHighlight(source.id);
  const keyRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onUp = () => {
      const container = document.querySelector(paged ? '[data-testid="pdf-pages"]' : '[data-testid="source-text"]');
      const r = !container ? null : paged ? pdfSelectionOffsets(container, st) : selectionOffsets(container, text);
      if (!r || r.end - r.start < 2) {
        setSel(null);
        return;
      }
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      setSel({ ...r, top: rect.top - 44, left: rect.left + rect.width / 2 });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [text, st, paged]);
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "h" || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      keyRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel]);
  if (!sel) return null;
  const done = () => {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };
  const len = sel.end - sel.start;
  const highlight = () => {
    if (len > 20_000) toastError(s.highlights.addFailed, new Error(s.highlights.tooLong));
    else void addHighlight(text, sel.start, sel.end);
    done();
  };
  keyRef.current = highlight;
  const btn = "inline-flex h-7.5 items-center gap-1.5 rounded-control bg-primary px-2.5 text-[0.78125rem] font-semibold text-on-primary shadow-float";
  const highlightBtn = (
    <button className={len <= 300 ? cn(btn, "w-7.5 justify-center px-0") : btn} aria-label={s.highlights.add} title={s.highlights.addKey} onMouseDown={(e) => e.preventDefault()} onClick={highlight}>
      <Highlighter size={13} /> {len > 300 && s.highlights.add}
    </button>
  );
  return (
    <div style={{ position: "fixed", top: Math.max(8, sel.top), left: sel.left, transform: "translateX(-50%)" }} className="z-40">
      <Reveal y={4} className="group/sel relative">
        {len <= 300 ? (
          <>
            <button
              className={btn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                openAdd({
                  spaceId: source.spaceId,
                  kind: "cloze",
                  front: clozeFromSelection(text, sel.start, sel.end),
                  sourceId: source.id,
                  chunkStart: sel.start,
                  chunkEnd: sel.end,
                });
                done();
              }}
            >
              <Layers size={13} /> {s.cards.makeFromSelection}
            </button>
            <div className="absolute left-full top-0 pl-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/sel:opacity-100">{highlightBtn}</div>
          </>
        ) : (
          highlightBtn
        )}
      </Reveal>
    </div>
  );
}
