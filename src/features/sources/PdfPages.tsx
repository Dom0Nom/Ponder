import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { api } from "../../lib/ipc";
import { fold, occurrences, pageRange, quoteInLayer } from "../../lib/sources/pdfAnchor";
import { readLayer, type Layer } from "./pdfSelection";
import { s } from "../../lib/strings";
import type { SourceText } from "../../lib/types";
import { NoteEditor, type Anchored } from "./Highlights";
import "../../styles/pdf.css";

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_WIDTH = 900;

function PdfMark({ annot, rects }: { annot: Anchored; rects: DOMRect[] }) {
  const [open, setOpen] = useState(false);
  const first = rects[0];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {rects.map((r, i) => (
        <div
          key={i}
          aria-hidden
          className="pdf-highlight"
          data-note={annot.note ? "" : undefined}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
      <Popover.Anchor asChild>
        <button
          className="pdf-highlight-hit"
          data-annot={annot.id}
          data-testid="pdf-highlight"
          aria-label={s.highlights.edit}
          title={annot.note || undefined}
          style={{ left: first.left, top: first.top, width: first.width, height: first.height }}
          onClick={() => setOpen(true)}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="t-dropdown z-50 w-[300px] rounded-pane border border-border bg-surface p-2.5 text-body text-fg shadow-popover outline-none"
        >
          <NoteEditor annot={annot} onDone={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PdfPage({ doc, num, width, aspect, st, annots }: { doc: PDFDocumentProxy; num: number; width: number; aspect: number; st: SourceText; annots: Anchored[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(width * aspect);
  const [scale, setScale] = useState(1);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [marks, setMarks] = useState<{ annot: Anchored; rects: DOMRect[] }[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !width) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let text: TextLayer | null = null;
    (async () => {
      const page = await doc.getPage(num);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      if (cancelled) return;
      setHeight(viewport.height);
      setScale(viewport.scale);
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      const render = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      task = render;
      const div = layerRef.current!;
      div.replaceChildren();
      text = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport });
      await Promise.all([render.promise, text.render()]);
      if (!cancelled) setLayer(readLayer(div));
    })().catch((e) => {
      if (!cancelled && (e as Error)?.name !== "RenderingCancelledException") setFailed(e);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [doc, num, width, visible]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!layer || !el) return;
    const [from, to] = pageRange(st.pages, num, st.text.length);
    const box = el.getBoundingClientRect();
    const out: { annot: Anchored; rects: DOMRect[] }[] = [];
    for (const a of annots) {
      if (a.detached || a.end <= from || a.start >= to) continue;
      const hits = quoteInLayer(layer, a.quote);
      if (!hits.length) continue;
      const nth = occurrences(fold(st.text, from, to).norm, fold(a.quote).norm).filter((i) => i < fold(st.text, from, a.start).norm.length).length;
      const [hs, he] = hits[Math.min(nth, hits.length - 1)];
      const range = document.createRange();
      const [sn, so] = layer.at[hs];
      const [en, eo] = layer.at[he - 1];
      range.setStart(layer.nodes[sn], so);
      range.setEnd(layer.nodes[en], eo + 1);
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0.5 && r.height > 0.5)
        .map((r) => new DOMRect(r.left - box.left, r.top - box.top, r.width, r.height));
      if (rects.length) out.push({ annot: a, rects });
    }
    setMarks(out);
  }, [layer, annots, st, num, width]);

  return (
    <div
      ref={ref}
      data-pdf-page={num}
      data-testid="pdf-page"
      className="pdf-page relative mx-auto bg-white shadow-float"
      style={{ width, height, "--total-scale-factor": scale, "--scale-round-x": "1px", "--scale-round-y": "1px" } as CSSProperties}
      aria-label={s.sources.page(num)}
      onClick={(e) => {
        if (!window.getSelection()?.isCollapsed) return;
        const box = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - box.left;
        const y = e.clientY - box.top;
        const hit = marks.find((m) => m.rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom));
        if (hit) e.currentTarget.querySelector<HTMLButtonElement>(`[data-annot="${hit.annot.id}"]`)?.click();
      }}
    >
      {failed ? (
        <ErrorState size="sm" title={s.pdfView.pageFailed(num)} error={failed} className="absolute inset-0" />
      ) : (
        <>
          <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
          {!layer && visible && <Skeleton className="absolute inset-4" />}
          {marks.map((m) => (
            <PdfMark key={m.annot.id} annot={m.annot} rects={m.rects} />
          ))}
          <div ref={layerRef} className="textLayer" />
        </>
      )}
    </div>
  );
}

export default function PdfPages({ sourceId, st, annots, onShowText }: { sourceId: string; st: SourceText; annots: Anchored[]; onShowText: () => void }) {
  const bytes = useQuery({ queryKey: ["sourcePdf", sourceId], queryFn: () => api.sourcePdf(sourceId), staleTime: Infinity, gcTime: 60_000, retry: false });
  const [doc, setDoc] = useState<{ pdf: PDFDocumentProxy; aspect: number } | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(MAX_WIDTH, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!bytes.data) return;
    let cancelled = false;
    // pdf.js takes ownership of the buffer, so it gets a copy and the cached bytes stay usable
    const task = getDocument({ data: new Uint8Array(bytes.data.slice(0)) });
    task.promise
      .then(async (p) => {
        const first = (await p.getPage(1)).getViewport({ scale: 1 });
        if (!cancelled) setDoc({ pdf: p, aspect: first.height / first.width });
      })
      .catch((e) => !cancelled && setFailed(e));
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes.data]);

  const missing = (bytes.error as { code?: string } | null)?.code === "not_found";
  return (
    <div ref={boxRef} className="flex flex-col gap-4" data-testid="pdf-pages">
      {missing ? (
        <div className="flex flex-col items-start gap-3 rounded-card border border-border px-3.5 py-3 text-body text-fg-secondary">
          <p>{s.pdfView.missing}</p>
          <Button size="sm" variant="secondary" onClick={onShowText}>
            {s.pdfView.showText}
          </Button>
        </div>
      ) : bytes.error || failed ? (
        <ErrorState title={s.pdfView.failed} error={bytes.error ?? failed} onRetry={() => (setFailed(null), void bytes.refetch())} />
      ) : !doc || !width ? (
        <Skeleton className="mx-auto aspect-[1/1.41] w-full max-w-[900px]" />
      ) : (
        Array.from({ length: doc.pdf.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc.pdf} num={i + 1} width={width} aspect={doc.aspect} st={st} annots={annots} />
        ))
      )}
    </div>
  );
}
