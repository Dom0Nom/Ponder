import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { AddCardDialog } from "../cards/FlashcardsCard";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { uniqueTitle } from "../../lib/notes/links";
import { useSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Note } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { qkNotes } from "./keys";
import { NoteEditor } from "./NoteEditor";

export function NotesScreen({ spaceId, noteId }: { spaceId: string; noteId?: string }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const space = useSpace(spaceId);
  const notes = useQuery({ queryKey: qkNotes(spaceId), queryFn: () => api.notesList(spaceId) });
  const [activeId, setActiveId] = useState<string | null>(noteId ?? null);
  const [creating, setCreating] = useState(false);

  useEffect(() => setActiveId(noteId ?? null), [noteId]);

  const list = notes.data ?? [];
  const active = list.find((n) => n.id === activeId) ?? (noteId || creating ? undefined : list[0]);

  const create = async (title?: string) => {
    setCreating(true);
    try {
      const n = await api.noteSave({ spaceId, title: title ?? uniqueTitle(list, s.notes.untitled), body: "", useAsSource: false });
      qc.setQueryData<Note[]>(qkNotes(spaceId), (cur) => [n, ...(cur ?? [])]);
      setActiveId(n.id);
      return n;
    } catch (e) {
      toastError(s.notes.createFailed, e, () => void create(title));
      return null;
    } finally {
      setCreating(false);
    }
  };

  const afterDelete = (id: string) => {
    qc.setQueryData<Note[]>(qkNotes(spaceId), (cur) => (cur ?? []).filter((n) => n.id !== id));
    void qc.invalidateQueries({ queryKey: ["sources", spaceId] });
    setActiveId(null);
  };

  return (
    <div className="flex h-full" data-testid="notes-screen">
      <aside className="flex w-[260px] shrink-0 flex-col gap-2 border-e border-divider p-3" aria-label={s.notes.listLabel}>
        <Button variant="ghost-muted" size="sm" className="-ms-1 justify-start" onClick={() => navigate({ name: "space", spaceId })}>
          <ArrowLeft size={14} />
          {space.data ? s.common.backTo(space.data.name) : s.common.back}
        </Button>
        <div className="flex items-center gap-2 px-1 pt-1">
          <h1 className="flex-1 text-title font-semibold">{s.notes.title}</h1>
          <Button variant="primary" size="sm" disabled={creating} onClick={() => void create()} data-testid="note-new">
            <Plus size={14} />
            {s.notes.new}
          </Button>
        </div>
        {notes.isLoading ? (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : notes.error ? (
          <ErrorState size="sm" title={s.notes.loadFailed} error={notes.error} onRetry={() => notes.refetch()} />
        ) : list.length === 0 ? (
          <p className="px-1 text-body text-muted">{s.notes.emptyTitle}</p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" data-testid="notes-list">
            {list.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setActiveId(n.id)}
                  aria-current={n.id === active?.id}
                  data-note-id={n.id}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-control px-2.5 text-start font-medium hover:bg-fill",
                    n.id === active?.id && "bg-fill-active",
                  )}
                >
                  <FileText size={14} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  {n.sourceId && <span className="size-1.5 shrink-0 rounded-full bg-fg-secondary" title={s.notes.useAsSource} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">
        {notes.isLoading || space.isLoading ? (
          <div className="mx-auto max-w-[760px] space-y-3 px-10 py-9">
            <Skeleton className="h-10" />
            <Skeleton className="h-64" />
          </div>
        ) : notes.error ? null : active ? (
          <NoteEditor
            key={active.id}
            note={active}
            notes={list}
            spaceId={spaceId}
            space={space.data}
            onOpen={setActiveId}
            onCreateLinked={async (title) => {
              const n = await create(title);
              return n?.id ?? null;
            }}
            onDeleted={afterDelete}
          />
        ) : (
          <EmptyState
            className="h-full"
            icon={<FileText size={20} />}
            title={noteId ? s.notes.notFound : s.notes.emptyTitle}
            body={s.notes.emptyBody}
            action={
              <Button variant="primary" onClick={() => void create()}>
                <Plus size={14} />
                {s.notes.new}
              </Button>
            }
          />
        )}
      </section>
      {space.data && <AddCardDialog space={space.data} />}
    </div>
  );
}
