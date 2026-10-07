import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { pickDefaultModel } from "../../lib/providers/catalog";
import { qk, useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { LanServer } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { ensureAppDefault } from "./providerQueries";
import { SubPage } from "./SubPage";

const norm = (u: string | null | undefined) => (u ?? "").trim().replace(/\/+$/, "").toLowerCase();
const hostPort = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export function LanScanPage() {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
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

  const { mutate: runScan } = scan;
  useEffect(() => runScan(), [runScan]);

  const added = (srv: LanServer) => providers?.some((p) => norm(p.baseUrl) === norm(srv.baseUrl));

  return (
    <SubPage
      crumb={s.settings.crumbProviders}
      section="providers"
      title={s.providers.scanTitle}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
            <RefreshCw size={14} aria-hidden />
            {s.providers.scanAgain}
          </Button>
          <Button variant="primary" onClick={() => navigate({ name: "settings", section: "providers" })}>
            {s.common.done}
          </Button>
        </>
      }
    >
      {scan.isPending || scan.isIdle ? (
        <div className="flex items-center gap-3 py-4 text-body text-muted" role="status">
          <Spinner />
          {s.providers.scanning}
        </div>
      ) : scan.isError ? (
        <ErrorState size="sm" title={s.providers.scanError} error={scan.error} onRetry={() => scan.mutate()} />
      ) : !scan.data?.length ? (
        <EmptyState size="sm" icon={<Radar size={17} />} title={s.providers.scanEmpty} body={s.providers.scanEmptyBody} />
      ) : (
        <ul className="rounded-card border border-border px-4 [&>*+*]:border-t [&>*+*]:border-divider">
          {scan.data.map((srv) => {
            const isAdded = added(srv);
            const adding = add.isPending && add.variables?.baseUrl === srv.baseUrl;
            return (
              <li key={srv.baseUrl} className="flex min-h-11 items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-body-lg font-medium">{s.providers.kinds[srv.kind]}</span>
                  <span className="truncate text-label text-muted" title={srv.models.join(", ")}>
                    {hostPort(srv.baseUrl)} · {s.providers.modelCount(srv.models.length)}
                  </span>
                </div>
                {isAdded ? (
                  <span className="font-medium text-muted">{s.providers.added}</span>
                ) : (
                  <Button variant="secondary" disabled={adding} onClick={() => add.mutate(srv)}>
                    {adding && <Spinner size={14} />}
                    {s.common.add}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SubPage>
  );
}
