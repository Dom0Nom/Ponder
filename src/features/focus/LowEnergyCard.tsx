import { BookOpen, GraduationCap, Leaf, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { useDueCounts, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Source, Space } from "../../lib/types";
import { useUi } from "../../stores/ui";

/** Light-reading pick: the most recently added ready source. */
export function pickReadingSource(sources: Source[] | undefined): Source | null {
  const ready = (sources ?? []).filter((x) => x.status === "ready");
  return ready.reduce<Source | null>((best, x) => (!best || x.createdAt > best.createdAt ? x : best), null);
}

export function LowEnergyCard({ space }: { space: Space }) {
  const navigate = useUi((st) => st.navigate);
  const openViewer = useUi((st) => st.openViewer);
  const counts = useDueCounts();
  const sources = useSources(space.id);
  const t = s.focus.lowEnergy;
  const due = counts.data?.find((x) => x.spaceId === space.id)?.due ?? 0;
  const reading = pickReadingSource(sources.data);

  return (
    <div className="rounded-[var(--radius-card)] border border-accent/30 bg-accent-soft p-4" data-testid="low-energy-card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-medium text-accent-text">
        <Leaf size={15} /> {t.title}
      </h3>
      <p className="text-xs text-muted">{t.body}</p>
      {(counts.error || sources.error) && (
        <ErrorState
          className="mt-2"
          title={s.errors.generic}
          error={counts.error ?? sources.error}
          onRetry={() => {
            void counts.refetch();
            void sources.refetch();
          }}
        />
      )}
      {(counts.isLoading || sources.isLoading) && <Skeleton className="mt-3 h-16" />}
      {!counts.isLoading && !sources.isLoading && (
        <div className="mt-3 flex flex-col gap-1.5">
          <Button
            size="sm"
            variant="primary"
            className="justify-start"
            disabled={due === 0}
            onClick={() => navigate({ name: "review", spaceId: space.id })}
          >
            <GraduationCap size={15} /> {t.reviewCards} · {due > 0 ? t.cardsDue(due) : t.nothingDue}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="justify-start"
            onClick={() => navigate({ name: "review", spaceId: space.id, tab: "mistakes" })}
          >
            <RotateCcw size={15} /> {t.retestMistakes}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="justify-start"
            disabled={!reading}
            title={reading ? undefined : t.readingNone}
            onClick={() => reading && openViewer({ sourceId: reading.id })}
          >
            <BookOpen size={15} />
            <span className="truncate">{reading ? t.readingOpen(reading.title) : t.readingNone}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
