import { BookOpen, ChevronRight, Layers, RotateCcw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { useDueCounts, useMistakes, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Source, Space } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { StudioSubpanel } from "../space/StudioSubpanel";

/** Light-reading pick: the most recently added ready source. */
export function pickReadingSource(sources: Source[] | undefined): Source | null {
  const ready = (sources ?? []).filter((x) => x.status === "ready");
  return ready.reduce<Source | null>((best, x) => (!best || x.createdAt > best.createdAt ? x : best), null);
}

function Row({ icon: Icon, title, disabled, onClick, children }: { icon: LucideIcon; title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-13 w-full items-center gap-3 text-left not-first:border-t not-first:border-divider disabled:opacity-50"
    >
      <Icon size={15} className="shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{title}</span>
        <span className="truncate text-label text-muted">{children}</span>
      </span>
      <ChevronRight size={14} className="shrink-0" />
    </button>
  );
}

export function LowEnergyView({ space, onBack }: { space: Space; onBack: () => void }) {
  const navigate = useUi((st) => st.navigate);
  const openViewer = useUi((st) => st.openViewer);
  const counts = useDueCounts();
  const sources = useSources(space.id);
  const mistakes = useMistakes(space.id);
  const t = s.focus.lowEnergy;
  const due = counts.data?.find((x) => x.spaceId === space.id)?.due ?? 0;
  const open = (mistakes.data ?? []).filter((m) => !m.resolved).length;
  const reading = pickReadingSource(sources.data);
  const loading = counts.isLoading || sources.isLoading || mistakes.isLoading;
  const error = counts.error ?? sources.error ?? mistakes.error;

  return (
    <StudioSubpanel title={t.title} onBack={onBack}>
      <p className="leading-[1.5] text-muted">{t.subtitle}</p>
      {error && (
        <ErrorState
          title={s.errors.generic}
          error={error}
          onRetry={() => {
            void counts.refetch();
            void sources.refetch();
            void mistakes.refetch();
          }}
        />
      )}
      {loading && !error && <Skeleton className="h-39 rounded-card" />}
      {!loading && !error && (
        <div data-testid="low-energy-card" className="rounded-card border border-border px-3.5">
          <Row icon={Layers} title={t.reviewCards} disabled={due === 0} onClick={() => navigate({ name: "review", spaceId: space.id })}>
            {due > 0 ? t.cardsDue(due) : t.nothingDue}
          </Row>
          <Row icon={RotateCcw} title={t.retestMistakes} onClick={() => navigate({ name: "review", spaceId: space.id, tab: "mistakes" })}>
            {open > 0 ? t.toWorkOn(open) : t.nothingToRetest}
          </Row>
          <Row icon={BookOpen} title={t.reading} disabled={!reading} onClick={() => reading && openViewer({ sourceId: reading.id })}>
            {reading ? t.readingOpen(reading.title) : t.readingNone}
          </Row>
        </div>
      )}
    </StudioSubpanel>
  );
}
