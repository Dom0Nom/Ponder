import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Link2, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Segmented, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { api } from "../../lib/ipc";
import {
  applyCompletion,
  backlinks as computeBacklinks,
  brokenLinks,
  linkify,
  linkQueryAt,
  NEW_NOTE_HREF,
  NOTE_HREF,
  normTitle,
  parseLinks,
  renameLinks,
  suggestions,
} from "../../lib/notes/links";
import { invalidateCards, useCards } from "../../lib/queries";
import { clozeFromSelection, expandCloze } from "../../lib/srs/cloze";
import { generateCards, type Passage } from "../../lib/srs/generate";
import { s } from "../../lib/strings";
import type { Note, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useAddCard } from "../cards/FlashcardsCard";
import { Markdown } from "../chat/Markdown";
import { GlossaryPanel } from "./GlossaryPanel";
import { qkNotes } from "./keys";
import { splitPassages } from "../../lib/notes/passages";

const SAVE_DELAY = 700;
/** Re-indexing the linked source waits for a longer pause than saving the note. */
const SOURCE_DELAY = 6000;

type Mode = "edit" | "preview";

export function NoteEditor({
  note,
  notes,
  spaceId,
  space,
  onOpen,
  onCreateLinked,
  onDeleted,
}: {
  note: Note;
  notes: Note[];
  spaceId: string;
  space: Space | undefined;
  onOpen: (id: string) => void;
  onCreateLinked: (title: string) => Promise<string | null>;
  onDeleted: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [useAsSource, setUseAsSource] = useState(note.useAsSource);
  const [mode, setMode] = useState<Mode>("edit");
  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clozing, setClozing] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const sourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceDirty = useRef(false);
  const latest = useRef({ title, body, useAsSource });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const titleAtFocus = useRef(note.title);
  const openAdd = useAddCard((st) => st.open);
  const cards = useCards(spaceId);
  latest.current = { title, body, useAsSource };

  const source = useQuery({
    queryKey: ["source", note.sourceId],
    queryFn: () => api.getSource(note.sourceId as string),
    enabled: !!note.sourceId,
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 800 : false),
  });

  const flush = useCallback(async (sync = true) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const syncNow = sync && sourceDirty.current;
    if (syncNow && sourceTimer.current) clearTimeout(sourceTimer.current);
    if (!dirty.current && !syncNow) return;
    dirty.current = false;
    if (syncNow) sourceDirty.current = false;
    const cur = latest.current;
    chain.current = chain.current.then(async () => {
      try {
        const saved = await api.noteSave({ id: note.id, spaceId, title: cur.title, body: cur.body, useAsSource: cur.useAsSource }, syncNow);
        qc.setQueryData<Note[]>(qkNotes(spaceId), (list) => (list ?? []).map((n) => (n.id === saved.id ? saved : n)));
        if (saved.sourceId !== note.sourceId || cur.useAsSource) void qc.invalidateQueries({ queryKey: ["sources", spaceId] });
        if (saved.sourceId) void qc.invalidateQueries({ queryKey: ["source", saved.sourceId] });
        if (!dirty.current) setStatus("saved");
      } catch (e) {
        dirty.current = true;
        if (syncNow) sourceDirty.current = true;
        toastError(s.notes.saveFailed, e, () => void flush());
      }
    });
    await chain.current;
  }, [note.id, note.sourceId, qc, spaceId]);

  const changed = () => {
    dirty.current = true;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(false), SAVE_DELAY);
    if (latest.current.useAsSource || note.sourceId) {
      sourceDirty.current = true;
      if (sourceTimer.current) clearTimeout(sourceTimer.current);
      sourceTimer.current = setTimeout(() => void flush(), SOURCE_DELAY);
    }
  };

  useEffect(
    () => () => {
      if (dirty.current || sourceDirty.current) void flush();
    },
    [flush],
  );

  useEffect(() => {
    if (pendingCaret.current != null && area.current) {
      area.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [body]);

  const others = useMemo(() => notes.map((n) => (n.id === note.id ? { ...n, title, body } : n)), [notes, note.id, title, body]);
  const me = useMemo(() => ({ ...note, title, body }), [note, title, body]);
  const incoming = useMemo(() => computeBacklinks(others, me), [others, me]);
  const missing = useMemo(() => brokenLinks(others, me), [others, me]);
  const outgoing = useMemo(() => parseLinks(body), [body]);

  const linkQ = mode === "edit" ? linkQueryAt(body, caret) : null;
  const sugg = linkQ && dismissedAt !== linkQ.start ? suggestions(notes, linkQ.query, note.id) : [];
  const popup = sugg.length > 0;

  const pick = (n: Note) => {
    if (!linkQ) return;
    const r = applyCompletion(body, caret, linkQ.start, n.title);
    pendingCaret.current = r.caret;
    setBody(r.body);
    setCaret(r.caret);
    setActive(0);
    changed();
    area.current?.focus();
  };

  const syncCaret = () => setCaret(area.current?.selectionStart ?? 0);

  const commitTitle = async () => {
    const old = titleAtFocus.current;
    const next = title.trim();
    if (!next || normTitle(old) === normTitle(next)) return;
    titleAtFocus.current = next;
    await flush();
    const affected = notes.filter((n) => n.id !== note.id && parseLinks(n.body).some((t) => normTitle(t) === normTitle(old)));
    for (const n of affected) {
      try {
        const saved = await api.noteSave({ ...n, body: renameLinks(n.body, old, next) });
        qc.setQueryData<Note[]>(qkNotes(spaceId), (list) => (list ?? []).map((x) => (x.id === saved.id ? saved : x)));
      } catch (e) {
        toastError(s.notes.saveFailed, e);
      }
    }
  };

  const onPreviewClick = async (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    if (href.startsWith(NOTE_HREF)) {
      e.preventDefault();
      await flush();
      onOpen(href.slice(NOTE_HREF.length));
    } else if (href.startsWith(NEW_NOTE_HREF)) {
      e.preventDefault();
      await flush();
      const id = await onCreateLinked(decodeURIComponent(href.slice(NEW_NOTE_HREF.length)));
      if (id) onOpen(id);
    }
  };

  const makeCloze = async () => {
    const el = area.current;
    const a = el?.selectionStart ?? 0;
    const b = el?.selectionEnd ?? 0;
    if (mode === "edit" && b > a && body.slice(a, b).trim()) {
      openAdd({
        spaceId,
        kind: "cloze",
        front: clozeFromSelection(body, a, b),
        sourceId: note.sourceId,
        chunkStart: note.sourceId ? a : null,
        chunkEnd: note.sourceId ? b : null,
      });
      return;
    }
    if (!body.trim()) {
      toast.error(s.notes.clozeEmpty);
      return;
    }
    setClozing(true);
    try {
      await flush();
      const llm = await resolveChatModel(space);
      const all = splitPassages(body, 1500);
      const step = Math.max(1, Math.ceil(all.length / 8));
      const passages: Passage[] = all
        .filter((_, i) => i % step === 0)
        .map((p) => ({ sourceId: note.sourceId ?? "", sourceTitle: title, text: p.text, start: p.start, end: p.end }));
      const made = await generateCards(llm, passages, { count: 6, only: "cloze", existingFronts: (cards.data ?? []).map((c) => c.front), language: space?.language });
      const linked = made.map((c) => ({
        ...c,
        sourceId: note.sourceId,
        chunkStart: note.sourceId ? c.chunkStart : null,
        chunkEnd: note.sourceId ? c.chunkEnd : null,
      }));
      const added = await api.cardsAdd(spaceId, linked.flatMap((c) => expandCloze(c)));
      invalidateCards(spaceId);
      toast.success(s.notes.clozeDone(added.length));
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.notes.clozeFailed, e, () => void makeCloze());
    } finally {
      setClozing(false);
    }
  };

  const remove = async () => {
    try {
      dirty.current = false;
      if (timer.current) clearTimeout(timer.current);
      await api.noteDelete(note.id);
      onDeleted(note.id);
    } catch (e) {
      toastError(s.notes.deleteFailed, e);
    }
  };

  const toggleSource = (on: boolean) => {
    setUseAsSource(on);
    latest.current = { ...latest.current, useAsSource: on };
    changed();
    void flush();
  };

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-10 pb-12 pt-8" data-testid="note-editor" data-note-id={note.id}>
      <input
        value={title}
        aria-label={s.notes.titleLabel}
        data-testid="note-title"
        onFocus={() => (titleAtFocus.current = note.title)}
        onChange={(e) => {
          setTitle(e.target.value);
          changed();
        }}
        onBlur={() => void commitTitle()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-full border-0 bg-transparent p-0 text-page font-semibold text-fg outline-none placeholder:text-faint"
        placeholder={s.notes.untitled}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented<Mode>
          label={s.notes.view}
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "edit", label: s.notes.edit },
            { value: "preview", label: s.notes.preview },
          ]}
        />
        <span className="text-label text-muted" role="status" data-testid="note-status">
          {status === "saving" ? s.notes.saving : s.notes.saved}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-body text-fg-secondary" title={s.notes.useAsSourceHelp}>
            <Switch checked={useAsSource} onCheckedChange={toggleSource} label={s.notes.useAsSource} size="sm" />
            {s.notes.useAsSource}
            {note.sourceId && source.data && (
              <span className="text-label text-muted" data-testid="note-source-status">
                {source.data.status === "ready" ? s.notes.sourceReady : source.data.status === "error" ? s.notes.sourceError : s.notes.sourceIndexing}
              </span>
            )}
          </span>
          <Button variant="secondary" size="sm" disabled={clozing} onClick={() => void makeCloze()} data-testid="note-cloze">
            {clozing ? <Sparkles size={13} /> : <Layers size={13} />}
            {s.notes.cloze}
          </Button>
          <Button variant="ghost-muted" size="icon-sm" title={s.notes.delete} aria-label={s.notes.delete} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {clozing && <GeneratingStatus label={s.notes.clozeWorking} className="text-muted" />}
      {mode === "edit" ? (
        <div className="relative">
          <textarea
            ref={area}
            value={body}
            aria-label={s.notes.bodyLabel}
            data-testid="note-body"
            placeholder={s.notes.bodyPlaceholder}
            onChange={(e) => {
              setBody(e.target.value);
              setCaret(e.target.selectionStart);
              setDismissedAt(null);
              setActive(0);
              changed();
            }}
            onSelect={syncCaret}
            onClick={syncCaret}
            onKeyUp={syncCaret}
            onKeyDown={(e) => {
              if (!popup) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length);
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(sugg[Math.min(active, sugg.length - 1)]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDismissedAt(linkQ?.start ?? null);
              }
            }}
            className="min-h-[360px] w-full resize-y rounded-pane border border-control bg-surface px-3.5 py-3 font-mono text-[0.84375rem] leading-[1.65] text-fg placeholder:text-faint focus:border-fg focus:outline-none"
          />
          {popup && (
            <ul
              role="listbox"
              aria-label={s.notes.linkSuggestions}
              data-testid="link-suggestions"
              className="absolute bottom-2 start-3 z-10 flex w-[min(320px,calc(100%-24px))] flex-col rounded-pane border border-border bg-surface p-1 shadow-menu"
            >
              {sugg.map((n, i) => (
                <li
                  key={n.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(n);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-control px-2.5 font-medium", i === active && "bg-fill-active")}
                >
                  <Link2 size={13} className="text-muted" />
                  <span className="truncate">{n.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-[200px]" data-testid="note-preview" onClick={(e) => void onPreviewClick(e)}>
          {body.trim() ? <Markdown text={linkify(body, notes.map((n) => (n.id === note.id ? me : n)))} /> : <p className="text-muted">{s.notes.bodyPlaceholder}</p>}
        </div>
      )}
      <section className="flex flex-col gap-2 border-t border-divider pt-4" data-testid="backlinks">
        <h2 className="text-label font-semibold text-muted">{s.notes.backlinks}</h2>
        {incoming.length === 0 ? (
          <p className="text-body text-muted">{s.notes.noBacklinks}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {incoming.map((n) => (
              <li key={n.id}>
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-start font-medium hover:bg-fill"
                  onClick={async () => {
                    await flush();
                    onOpen(n.id);
                  }}
                >
                  <Link2 size={13} className="text-muted" />
                  <span className="truncate">{n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {missing.length > 0 && outgoing.length > 0 && (
          <div className="flex flex-col gap-1 pt-1" data-testid="missing-links">
            <h3 className="text-label font-semibold text-muted">{s.notes.notWritten}</h3>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((t) => (
                <Button
                  key={t}
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    await flush();
                    const id = await onCreateLinked(t);
                    if (id) onOpen(id);
                  }}
                >
                  {s.notes.createLinked(t)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </section>
      <GlossaryPanel subjectId={note.id} text={body} space={space} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={s.notes.deleteTitle}
        body={s.notes.deleteBody}
        confirmLabel={s.common.delete}
        danger
        onConfirm={() => void remove()}
      />
    </div>
  );
}
