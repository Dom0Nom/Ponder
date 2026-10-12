import { useRef, useState } from "react";
import { Reveal } from "../../components/motion/Reveal";
import { useFlip } from "../../lib/useFlip";
import { useFreshKeys } from "../../lib/useFreshKeys";
import { Ellipsis, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { useDeleteSpace, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import { relativeTime } from "../../lib/utils";
import { SpaceIcon } from "../../lib/spaceStyle";
import type { Space } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../components/ui/menu";
import { toastError } from "../../components/ui/toast";
import { TodaySection } from "../plan/TodaySection";
import { SpaceDialog } from "./SpaceDialog";

export function HomeScreen() {
  const { data, isLoading, error, refetch } = useSpaces();
  const setSpaceDialogOpen = useUi((st) => st.setSpaceDialogOpen);
  const [editing, setEditing] = useState<Space | null>(null);
  const [deleting, setDeleting] = useState<Space | null>(null);
  const deleteSpace = useDeleteSpace();
  const gridRef = useRef<HTMLDivElement>(null);
  const isFresh = useFreshKeys(data?.map((x) => x.id));
  useFlip(gridRef, [data]);

  const remove = async (sp: Space) => {
    try {
      await deleteSpace(sp.id);
    } catch (e) {
      toastError(s.errors.generic, e, () => remove(sp));
    }
  };

  if (data && data.length === 0)
    return (
      <EmptyState
        className="h-full"
        icon={<LayoutGrid size={20} />}
        title={s.home.emptyTitle}
        body={s.home.emptyBody}
        action={
          <Button variant="primary" size="lg" onClick={() => setSpaceDialogOpen(true)}>
            <Plus size={15} />
            {s.home.newSpace}
          </Button>
        }
      />
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-10 pb-12 pt-11">
        <div className="flex items-center gap-4">
          <h1 className="flex-1 text-page font-semibold">{s.home.title}</h1>
          <Button variant="primary" size="lg" onClick={() => setSpaceDialogOpen(true)}>
            <Plus size={16} />
            {s.home.newSpace}
          </Button>
        </div>
        <TodaySection />
        {isLoading && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[168px] rounded-card" />
            ))}
          </div>
        )}
        {error && <ErrorState title={s.home.loadError} error={error} onRetry={() => refetch()} />}
        {data && data.length > 0 && (
          <div ref={gridRef} className="relative grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3" data-testid="space-grid">
            {data.map((sp) => (
              <Reveal key={sp.id} active={isFresh(sp.id)} data-flip-key={sp.id}>
                <SpaceCard space={sp} onEdit={() => setEditing(sp)} onDelete={() => setDeleting(sp)} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
      {editing && <SpaceDialog open onOpenChange={(o) => !o && setEditing(null)} space={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={s.space.deleteTitle(deleting?.name ?? "")}
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
      className="group relative flex h-[168px] cursor-pointer flex-col rounded-card border border-border bg-surface p-4.5 transition-colors hover:bg-fill-faint has-[[data-state=open]]:bg-fill-faint"
      data-testid="space-card"
    >
      <div className="flex items-start justify-between">
        <SpaceIcon icon={space.icon} />
        <Menu>
          <MenuTrigger asChild>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={s.home.spaceOptions}
              onClick={(e) => e.stopPropagation()}
              className="-mr-1.5 -mt-1 opacity-0 transition-opacity duration-(--motion-quick) focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <Ellipsis size={16} />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" sideOffset={2} className="w-[150px]" onClick={(e) => e.stopPropagation()}>
            <MenuItem onSelect={onEdit}>
              <Pencil size={14} />
              {s.common.edit}
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={onDelete}>
              <Trash2 size={14} />
              {s.common.delete}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <h2 className="mt-3.5 truncate text-title font-semibold">{space.name}</h2>
      <p className="mt-0.75 line-clamp-2 text-body text-muted">
        {space.recap ?? (space.lastOpenedAt ? `${s.home.lastOpened} ${relativeTime(space.lastOpenedAt)}` : s.home.never)}
      </p>
      <p className="mt-auto text-label text-muted">{s.home.sources(space.sourceCount)}</p>
    </div>
  );
}
