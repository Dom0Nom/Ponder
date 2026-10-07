import { Plus, Radar, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import { ProviderCard } from "./ProviderCard";

export function ProvidersSection() {
  const { data: providers, isLoading, error, refetch } = useProviders();
  const navigate = useUi((st) => st.navigate);
  const justAdded = useUi((st) => st.justAddedProvider);

  const actions = (
    <div className="mt-3 flex gap-2">
      <Button variant="primary" onClick={() => navigate({ name: "settings", page: { kind: "addProvider" } })}>
        <Plus size={15} aria-hidden />
        {s.providers.add}
      </Button>
      <Button variant="secondary" onClick={() => navigate({ name: "settings", page: { kind: "lanScan" } })}>
        <Radar size={15} aria-hidden />
        {s.providers.scan}
      </Button>
    </div>
  );

  if (isLoading)
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-12 w-full rounded-card" />
        <Skeleton className="h-12 w-full rounded-card" />
      </div>
    );
  if (error) return <ErrorState title={s.providers.loadError} error={error} onRetry={() => refetch()} />;
  if (!providers?.length)
    return (
      <>
        <div className="rounded-card border border-border">
          <EmptyState
            size="sm"
            icon={<Sparkles size={17} />}
            title={s.providers.emptyTitle}
            body={s.providers.emptyBody}
          />
        </div>
        {actions}
      </>
    );
  return (
    <>
      <ul className="rounded-card border border-border [&>*+*]:border-t [&>*+*]:border-divider">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} justAdded={p.id === justAdded} />
        ))}
      </ul>
      {actions}
    </>
  );
}
