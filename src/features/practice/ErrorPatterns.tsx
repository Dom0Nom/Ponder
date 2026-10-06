import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { cn, relativeTime } from "../../lib/utils";
import { ErrorState, Skeleton } from "../../components/ui/misc";

export function ErrorPatterns({ spaceId, compact }: { spaceId?: string | null; compact?: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["errorPatterns", spaceId ?? null],
    queryFn: () => api.errorPatterns(spaceId),
  });
  if (isLoading) return <Skeleton className="h-10" />;
  if (error) return <ErrorState title={s.errorPatterns.loadFailed} error={error} onRetry={() => refetch()} />;
  const list = data ?? [];
  return (
    <div data-testid="error-patterns">
      <p className="mb-1.5 text-xs font-medium text-muted">{s.errorPatterns.title}</p>
      {list.length === 0 ? (
        <p className="text-xs text-faint">{s.errorPatterns.empty}</p>
      ) : (
        <ul className={cn("flex flex-wrap gap-1.5", !compact && "mb-1")}>
          {list.slice(0, compact ? 4 : undefined).map((p) => (
            <li
              key={p.errorType}
              title={compact ? s.errorPatterns.detail(p.topics, relativeTime(p.lastAt)) : undefined}
              className="rounded-full bg-warn-soft px-2.5 py-0.5 text-[0.75rem] text-warn"
            >
              {s.errorTypes[p.errorType]} <span className="tabular-nums opacity-80">×{p.count}</span>
              {!compact && p.topics.length > 0 && <span className="ml-1 text-[0.6875rem] opacity-80">· {p.topics.slice(0, 3).join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
