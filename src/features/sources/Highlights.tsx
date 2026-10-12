import * as Popover from "@radix-ui/react-popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Highlighter, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { ErrorState } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { anchorAnnotations } from "../../lib/sources/pieces";
import { s } from "../../lib/strings";
import type { Annotation } from "../../lib/types";

export type Anchored = Annotation & { detached: boolean };

export function useAnnotations(sourceId: string, text: string | undefined) {
  const q = useQuery({ queryKey: qk.annotations(sourceId), queryFn: () => api.annotationsList(sourceId) });
  const anchored = useMemo(() => (q.data && text != null ? anchorAnnotations(text, q.data) : []), [q.data, text]);
  return { q, anchored };
}

function pointOffset(container: Element, node: Node, offset: number, edge: "start" | "end"): number | null {
  const el = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest<HTMLElement>("[data-off]");
  if (!el || !container.contains(el)) {
    // the point sits outside the text (a page label): snap to the nearest text after a start or before an end
    const all = [...container.querySelectorAll<HTMLElement>("[data-off]")];
    const probe = document.createRange();
    probe.setStart(node, offset);
    const after = all.filter((x) => probe.comparePoint(x, 0) >= 0);
    if (edge === "start") return after.length ? Number(after[0].dataset.off) : null;
    const before = all.slice(0, all.length - after.length);
    const last = before[before.length - 1];
    return last ? Number(last.dataset.off) + (last.textContent ?? "").length : null;
  }
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(node, offset);
  return Number(el.dataset.off) + r.toString().length;
}

/** Maps the current selection inside `container` to offsets in the source text, trimmed of surrounding whitespace. */
export function selectionOffsets(container: Element, text: string): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!container.contains(r.startContainer) || !container.contains(r.endContainer)) return null;
  let start = pointOffset(container, r.startContainer, r.startOffset, "start");
  let end = pointOffset(container, r.endContainer, r.endOffset, "end");
  if (start == null || end == null || end <= start) return null;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end > start ? { start, end } : null;
}

export function useAddHighlight(sourceId: string) {
  const qc = useQueryClient();
  return async (text: string, start: number, end: number) => {
    try {
      await api.annotationAdd(sourceId, start, end, text.slice(start, end));
      await qc.invalidateQueries({ queryKey: qk.annotations(sourceId) });
    } catch (e) {
      toastError(s.highlights.addFailed, e);
    }
  };
}

export function NoteEditor({ annot, onDone }: { annot: Anchored; onDone: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(annot.note);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: qk.annotations(annot.sourceId) });
      onDone();
    } catch (e) {
      toastError(failed, e);
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(() => (annot.detached ? Promise.resolve() : api.annotationUpdate(annot.id, annot.start, annot.end, note.trim())), s.highlights.saveFailed);
  return (
    <div className="flex flex-col gap-2" data-testid="highlight-editor">
      <Textarea
        autoFocus
        rows={3}
        value={note}
        maxLength={10_000}
        aria-label={s.highlights.note}
        placeholder={s.highlights.notePlaceholder}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => api.annotationDelete(annot.id), s.highlights.removeFailed)}>
          <Trash2 size={13} /> {s.highlights.remove}
        </Button>
        {!annot.detached && (
          <Button variant="primary" size="sm" disabled={busy || note.trim() === annot.note} onClick={save}>
            {s.highlights.save}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A learner highlight in the text; clicking it opens its note. */
export function HighlightMark({ annot, children }: { annot: Anchored; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <mark
          className="user-highlight"
          data-annot={annot.id}
          data-note={annot.note ? "" : undefined}
          title={annot.note || undefined}
          role="button"
          tabIndex={0}
          aria-label={s.highlights.edit}
          onClick={(e) => {
            if (!window.getSelection()?.isCollapsed) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          {children}
        </mark>
      </Popover.Trigger>
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

/** Every highlight in the source, in reading order; clicking one scrolls to it. */
export function HighlightList({ anchored, error, onRetry }: { anchored: Anchored[]; error: unknown; onRetry: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (error) return <ErrorState size="sm" title={s.highlights.loadFailed} error={error} onRetry={onRetry} />;
  if (!anchored.length) return null;
  const sorted = [...anchored].sort((a, b) => Number(a.detached) - Number(b.detached) || a.start - b.start);
  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-border px-3.5 py-3" aria-label={s.highlights.title} data-testid="highlight-list">
      <div className="flex items-center gap-2">
        <Highlighter size={14} className="text-muted" />
        <h2 className="flex-1 text-label font-semibold text-muted">{s.highlights.title}</h2>
      </div>
      <ul className="flex flex-col gap-2">
        {sorted.map((a) => (
          <li key={a.id} className="flex flex-col gap-1 text-body" data-testid="highlight-item">
            <button
              className="line-clamp-2 rounded-btn text-left text-fg-secondary hover:text-fg disabled:hover:text-fg-secondary"
              disabled={a.detached}
              onClick={() => document.querySelector(`[data-annot="${a.id}"]`)?.scrollIntoView({ block: "center" })}
            >
              “{a.quote}”
            </button>
            {a.detached && <p className="text-label text-muted">{s.highlights.detached}</p>}
            {editing === a.id ? (
              <NoteEditor annot={a} onDone={() => setEditing(null)} />
            ) : (
              <button className="self-start text-left text-label text-muted hover:text-fg" onClick={() => setEditing(a.id)}>
                {a.note || s.highlights.notePlaceholder}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
