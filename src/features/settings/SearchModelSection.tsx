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

export function SearchModelSection() {
  const models = useQuery({ queryKey: qk.embeddingModels, queryFn: api.embeddingModels, staleTime: Infinity });
  const [st, setSt] = useState<EmbedderStatus | null>(null);
  const [busy, setBusy] = useState(false);
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
  const current = list.find((m) => m.id === st?.model) ?? list[0];
  if (!current) return null;

  const choose = async (id: string) => {
    if (id === current.id) return;
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

  return (
    <SettingsGroup data-testid="search-model-section">
      <SettingsRow
        title={s.searchModel.names[current.id] ?? current.id}
        description={
          <>
            {s.searchModel.detail(current.sizeMb, current.multilingual)}
            <br />
            <span data-testid="search-model-status">{statusText(st)}</span>
          </>
        }
      >
        <NativeSelect
          className="w-44"
          aria-label={s.searchModel.label}
          value={current.id}
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
    </SettingsGroup>
  );
}
