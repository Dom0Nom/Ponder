import { Plus, Radar, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import { AddProviderDialog } from "./AddProviderDialog";
import { LanScanDialog } from "./LanScanDialog";
import { ProviderCard } from "./ProviderCard";

export function ProvidersSection() {
  const { data: providers, isLoading, error, refetch } = useProviders();
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => setAddOpen(true)}>
        <Plus size={16} aria-hidden />
        {s.providers.add}
      </Button>
      <Button variant="secondary" onClick={() => setScanOpen(true)}>
        <Radar size={16} aria-hidden />
        {s.providers.scan}
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
      </div>
    );
  } else if (error) {
    body = <ErrorState title={s.providers.loadError} error={error} onRetry={() => refetch()} />;
  } else if (!providers?.length) {
    body = (
      <EmptyState
        className="rounded-[var(--radius-card)] border border-dashed border-border"
        icon={<Sparkles size={20} />}
        title={s.providers.emptyTitle}
        body={s.providers.emptyBody}
        action={actions}
      />
    );
  } else {
    body = (
      <div className="space-y-4">
        {actions}
        <ul className="space-y-3">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} justAdded={p.id === justAdded} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <>
      {body}
      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(p) => {
          setJustAdded(p.id);
        }}
      />
      <LanScanDialog open={scanOpen} onOpenChange={setScanOpen} />
    </>
  );
}
