import { useState } from "react";
import { MoreVertical, Plus, LayoutGrid } from "lucide-react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useSpaces, qk } from "../../lib/queries";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { relativeTime } from "../../lib/utils";
import { SpaceIcon } from "../../lib/spaceStyle";
import type { Space } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { ConfirmDialog } from "../../components/ui/dialog";
import { toast, toastError } from "../../components/ui/toast";
import { SpaceDialog } from "./SpaceDialog";

export function HomeScreen() {
  const { data, isLoading, error, refetch } = useSpaces();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Space | null>(null);
  const [deleting, setDeleting] = useState<Space | null>(null);
  const qc = useQueryClient();

  const remove = async (sp: Space) => {
    try {
      await api.deleteSpace(sp.id);
      qc.invalidateQueries({ queryKey: qk.spaces });
      toast.success(s.space.deleted);
    } catch (e) {
      toastError(s.errors.generic, e, () => remove(sp));
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 pb-16 pt-6">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-semibold tracking-tight">{s.home.title}</h1>
            <p className="mt-1 text-muted">{s.home.subtitle}</p>
          </div>
          {data && data.length > 0 && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={18} /> {s.home.newSpace}
            </Button>
          )}
        </div>

        {isLoading && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-[var(--radius-card)]" />
            ))}
          </div>
        )}
        {error && <ErrorState title={s.home.loadError} error={error} onRetry={() => refetch()} />}
        {data && data.length === 0 && (
          <div className="rounded-[var(--radius-pane)] bg-surface py-10 shadow-card">
            <EmptyState
              icon={<LayoutGrid size={22} />}
              title={s.home.emptyTitle}
              body={s.home.emptyBody}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={18} /> {s.home.newSpace}
                </Button>
              }
            />
          </div>
        )}
        {data && data.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4" data-testid="space-grid">
            <button
              onClick={() => setCreating(true)}
              className="flex h-44 flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border text-muted transition-colors hover:border-accent hover:bg-surface hover:text-accent-text"
            >
              <Plus size={22} />
              <span className="font-medium">{s.home.newSpace}</span>
            </button>
            {data.map((sp) => (
              <SpaceCard key={sp.id} space={sp} onEdit={() => setEditing(sp)} onDelete={() => setDeleting(sp)} />
            ))}
          </div>
        )}
      </div>
      <SpaceDialog open={creating} onOpenChange={setCreating} />
      {editing && <SpaceDialog open onOpenChange={(o) => !o && setEditing(null)} space={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={s.space.deleteTitle}
        body={s.space.deleteBody}
        confirmLabel={s.common.delete}
        danger
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}

function SpaceCard({ space, onEdit, onDelete }: { space: Space; onEdit: () => void; onDelete: () => void }) {
  const navigate = useUi((st) => st.navigate);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate({ name: "space", spaceId: space.id })}
      onKeyDown={(e) => e.key === "Enter" && navigate({ name: "space", spaceId: space.id })}
      className="group relative flex h-44 cursor-pointer flex-col rounded-[var(--radius-card)] bg-surface p-5 shadow-card transition-shadow hover:shadow-md"
      data-testid="space-card"
    >
      <div className="flex items-start justify-between">
        <SpaceIcon icon={space.icon} color={space.color} size={18} />
        <DM.Root>
          <DM.Trigger asChild>
            <button
              aria-label="Space options"
              onClick={(e) => e.stopPropagation()}
              className="-mr-2 -mt-1 rounded-full p-1.5 text-muted opacity-0 hover:bg-surface-2 focus:opacity-100 group-hover:opacity-100"
            >
              <MoreVertical size={18} />
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content
              align="end"
              onClick={(e) => e.stopPropagation()}
              className="z-50 min-w-40 rounded-xl border border-border bg-surface p-1 shadow-lg"
            >
              <DM.Item onSelect={onEdit} className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
                {s.common.edit}
              </DM.Item>
              <DM.Item onSelect={onDelete} className="cursor-pointer rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft">
                {s.common.delete}
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
      <h2 className="mt-4 line-clamp-1 text-[1.0625rem] font-semibold">{space.name}</h2>
      <p className="mt-1 line-clamp-2 text-[0.8125rem] text-muted">
        {space.recap ?? (space.lastOpenedAt ? `${s.home.lastOpened} ${relativeTime(space.lastOpenedAt)}` : s.home.never)}
      </p>
      <p className="mt-auto text-xs text-faint">{s.home.sources(space.sourceCount)}</p>
    </div>
  );
}
