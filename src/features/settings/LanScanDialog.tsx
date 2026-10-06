import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Radar } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { EmptyState, ErrorState, Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { pickDefaultModel } from "../../lib/providers/catalog";
import { qk, useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { LanServer } from "../../lib/types";
import { ensureAppDefault } from "./providerQueries";

const norm = (u: string | null | undefined) => (u ?? "").trim().replace(/\/+$/, "").toLowerCase();

export function LanScanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: providers } = useProviders();
  const scan = useMutation({ mutationFn: api.lanScan });
  const add = useMutation({
    mutationFn: async (srv: LanServer) => {
      const host = new URL(srv.baseUrl).hostname;
      const p = await api.saveProvider({
        type: srv.kind,
        kind: "local",
        name: `${s.providers.kinds[srv.kind]} (${host})`,
        baseUrl: srv.baseUrl,
        config: { models: srv.models, defaultModel: pickDefaultModel(srv.models) },
      });
      await ensureAppDefault(p);
      return p;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.providers });
      qc.invalidateQueries({ queryKey: qk.settings });
    },
    onError: (e) => toastError(s.errors.generic, e),
  });

  const { mutate: runScan, reset } = scan;
  useEffect(() => {
    if (open) runScan();
    else reset();
  }, [open, runScan, reset]);

  const added = (srv: LanServer) => providers?.some((p) => norm(p.baseUrl) === norm(srv.baseUrl));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.providers.scanTitle}
      footer={
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          {s.providers.scanAgain}
        </Button>
      }
    >
      {scan.isPending || scan.isIdle ? (
        <div className="flex items-center gap-3 py-8 text-sm text-muted" role="status">
          <Spinner />
          {s.providers.scanning}
        </div>
      ) : scan.isError ? (
        <ErrorState title={s.providers.scanError} error={scan.error} onRetry={() => scan.mutate()} />
      ) : !scan.data?.length ? (
        <EmptyState icon={<Radar size={20} />} title={s.providers.scanEmpty} body={s.providers.scanEmptyBody} />
      ) : (
        <ul className="divide-y divide-border pb-2">
          {scan.data.map((srv) => {
            const isAdded = added(srv);
            return (
              <li key={srv.baseUrl} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.providers.kinds[srv.kind]}</p>
                  <p className="truncate font-mono text-xs text-muted">{srv.baseUrl}</p>
                  <p className="mt-0.5 truncate text-xs text-faint" title={srv.models.join(", ")}>
                    {s.providers.modelCount(srv.models.length)}
                    {srv.models.length > 0 && ` · ${srv.models.slice(0, 3).join(", ")}${srv.models.length > 3 ? "…" : ""}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={isAdded ? "ghost" : "tonal"}
                  disabled={isAdded || (add.isPending && add.variables?.baseUrl === srv.baseUrl)}
                  onClick={() => add.mutate(srv)}
                >
                  {isAdded ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                  {isAdded ? s.providers.added : s.common.add}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
