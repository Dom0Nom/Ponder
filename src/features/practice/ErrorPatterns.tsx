import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { relativeShort } from "../../lib/utils";
import { ErrorState, Skeleton } from "../../components/ui/misc";

export function ErrorPatterns({ spaceId }: { spaceId?: string | null }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["errorPatterns", spaceId ?? null],
    queryFn: () => api.errorPatterns(spaceId),
  });
  if (isLoading) return <Skeleton className="h-16 rounded-card" />;
  if (error) return <ErrorState title={s.errorPatterns.loadFailed} error={error} onRetry={() => refetch()} />;
  const list = data ?? [];
  return (
    <section className="flex flex-col gap-2.5" data-testid="error-patterns">
      <h2 className="text-title font-semibold">{s.errorPatterns.title}</h2>
      {list.length === 0 ? (
        <p className="text-body text-muted">{s.errorPatterns.empty}</p>
      ) : (
        list.map((p) => (
          <div key={p.errorType} className="flex flex-col gap-0.5 rounded-card border border-border px-3.5 py-3">
            <div className="flex justify-between font-semibold">
              <span>{s.errorTypes[p.errorType]}</span>
              <span className="tabular-nums">{p.count}</span>
            </div>
            <span className="text-label leading-[1.4] text-muted">
              {s.errorPatterns.detail(p.topics, relativeShort(p.lastAt))}
            </span>
          </div>
        ))
      )}
    </section>
  );
}
