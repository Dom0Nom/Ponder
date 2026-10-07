import { Reveal } from "../../components/motion/Reveal";
import { useFreshKeys } from "../../lib/useFreshKeys";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { useJournal } from "../../lib/queries";
import { s } from "../../lib/strings";
import { shortRelative } from "../../lib/utils";
import { StudioSubpanel } from "./StudioSubpanel";

export function JournalView({ spaceId, onBack }: { spaceId: string; onBack: () => void }) {
  const { data, isLoading, error, refetch } = useJournal(spaceId);
  const isFresh = useFreshKeys(data?.map((e) => e.id));
  return (
    <StudioSubpanel title={s.studio.journal} onBack={onBack}>
      {isLoading && <Skeleton className="h-12" />}
      {error && <ErrorState size="sm" title={s.studio.loadFailed} error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <p className="text-body text-muted">{s.journal.empty}</p>}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3.5">
          {data.slice(0, 20).map((e) => (
            <Reveal as="li" key={e.id} active={isFresh(e.id)} className="flex flex-col gap-[3px] not-first:border-t not-first:border-divider not-first:pt-3.5">
              <div className="flex items-baseline gap-2">
                <p className="flex-1 font-semibold">{e.title}</p>
                <span className="text-label text-muted">{shortRelative(e.createdAt)}</span>
              </div>
              <p className="line-clamp-12 whitespace-pre-wrap leading-[1.55] text-fg-secondary">{e.content}</p>
            </Reveal>
          ))}
        </ul>
      )}
    </StudioSubpanel>
  );
}
