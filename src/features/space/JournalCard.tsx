import { NotebookPen } from "lucide-react";
import { useJournal } from "../../lib/queries";
import { relativeTime } from "../../lib/utils";
import { Skeleton } from "../../components/ui/misc";

export function JournalCard({ spaceId }: { spaceId: string }) {
  const { data, isLoading, error } = useJournal(spaceId);
  return (
    <div className="rounded-[var(--radius-card)] border border-border p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <NotebookPen size={15} className="text-muted" /> Journal
      </h3>
      {isLoading && <Skeleton className="h-12" />}
      {error && <p className="text-xs text-danger">Couldn't load the journal: {String((error as Error).message)}</p>}
      {data && data.length === 0 && (
        <p className="text-xs text-muted">Session summaries land here when you end a focus session.</p>
      )}
      <ul className="space-y-3">
        {data?.slice(0, 10).map((e) => (
          <li key={e.id}>
            <p className="text-[0.8125rem] font-medium">{e.title}</p>
            <p className="text-xs text-faint">{relativeTime(e.createdAt)}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted line-clamp-6">{e.content}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
