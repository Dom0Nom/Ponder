import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, events } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { EmbedderStatus } from "../../lib/types";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { NativeSelect } from "./NativeSelect";
import { SettingsGroup, SettingsRow } from "./layout";

function statusText(st: EmbedderStatus | null): string | null {
  if (!st) return null;
  switch (st.state) {
    case "downloading":
      return s.sources.embedderDownloading(st.progress);
    case "loading":
      return s.sources.embedderLoading;
    case "indexing":
      return s.sources.embedderIndexing(st.progress);
    case "missing":
      return s.searchModel.missing;
    case "error":
      return st.error ?? s.sources.embedderError;
    case "ready":
      return s.searchModel.ready;
  }
}

const REMOTE = "openrouter:";

export function SearchModelSection() {
  const models = useQuery({ queryKey: qk.embeddingModels, queryFn: api.embeddingModels, staleTime: Infinity });
  const [st, setSt] = useState<EmbedderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const remoteId = st?.model.startsWith(REMOTE) ? st.model.slice(REMOTE.length) : null;
  const remote = useQuery({
    queryKey: qk.remoteEmbeddingModels,
    queryFn: api.openrouterEmbeddingModels,
    enabled: remoteId !== null,
    staleTime: 60 * 60_000,
    retry: false,
  });
  useEffect(() => {
    api.embedderStatus().then(setSt).catch(() => {});
    const un = events.embedderStatus(setSt);
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  if (models.isLoading) return <Skeleton className="h-16" />;
  if (models.error)
    return <ErrorState size="sm" title={s.errors.generic} error={models.error} onRetry={() => models.refetch()} />;
  const list = models.data ?? [];
  const local = list.find((m) => m.id === st?.model) ?? list[0];
  if (!local) return null;
  const currentId = remoteId !== null ? st!.model : local.id;

  const choose = async (id: string) => {
    if (id === currentId) return;
    setBusy(true);
    try {
      await api.setEmbeddingModel(id);
      setSt((prev) => (prev ? { ...prev, model: id } : prev));
      toast.success(s.searchModel.switched);
    } catch (e) {
      toastError(s.errors.generic, e, () => choose(id));
    } finally {
      setBusy(false);
    }
  };

  const remoteList = remote.data ?? [];
  const remoteOptions =
    remoteId !== null && !remoteList.some((m) => m.id === remoteId) ? [{ id: remoteId, name: remoteId, price: null }, ...remoteList] : remoteList;
  const remoteCurrent = remoteOptions.find((m) => m.id === remoteId);
  const status = <span data-testid="search-model-status">{statusText(st)}</span>;

  return (
    <SettingsGroup data-testid="search-model-section">
      <SettingsRow title={s.searchModel.runsOn} description={s.searchModel.runsOnBody}>
        <NativeSelect
          className="w-44"
          aria-label={s.searchModel.runsOn}
          value={remoteId !== null ? "openrouter" : "local"}
          disabled={busy}
          onChange={(e) => choose(e.target.value === "openrouter" ? REMOTE + s.searchModel.defaultRemote : list[0].id)}
        >
          <option value="local">{s.searchModel.local}</option>
          <option value="openrouter">{s.searchModel.openrouter}</option>
        </NativeSelect>
      </SettingsRow>
      {remoteId !== null ? (
        <SettingsRow
          title={remoteCurrent?.name ?? remoteId}
          description={
            <>
              {s.searchModel.remoteDetail}
              {remoteCurrent?.price != null && (
                <> · {remoteCurrent.price === 0 ? s.searchModel.free : s.searchModel.price(remoteCurrent.price)}</>
              )}
              <br />
              {remote.error ? s.searchModel.remoteListFailed : status}
            </>
          }
        >
          {remote.isLoading ? (
            <Skeleton className="h-8 w-44" />
          ) : (
            <NativeSelect
              className="w-44"
              aria-label={s.searchModel.label}
              value={remoteId}
              disabled={busy}
              onChange={(e) => choose(REMOTE + e.target.value)}
            >
              {remoteOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </SettingsRow>
      ) : (
        <SettingsRow
          title={s.searchModel.names[local.id] ?? local.id}
          description={
            <>
              {s.searchModel.detail(local.sizeMb, local.multilingual)}
              <br />
              {status}
            </>
          }
        >
          <NativeSelect
            className="w-44"
            aria-label={s.searchModel.label}
            value={local.id}
            disabled={busy}
            onChange={(e) => choose(e.target.value)}
          >
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {s.searchModel.names[m.id] ?? m.id}
              </option>
            ))}
          </NativeSelect>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
