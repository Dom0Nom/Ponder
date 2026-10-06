import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, events } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import type { ModelRef, OAuthStatus, Provider } from "../../lib/types";
import { pickDefaultModel } from "../../lib/providers/catalog";

export const pk = {
  secret: (id: string) => ["secret", id] as const,
  oauth: (id: string) => ["oauthStatus", id] as const,
};

export const useHasSecret = (id: string, enabled: boolean) =>
  useQuery({ queryKey: pk.secret(id), queryFn: () => api.hasSecret(id), enabled });

/** OAuth status, kept live from `oauth://status` events. */
export function useOAuthStatus(id: string, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    events
      .oauthStatus((st: OAuthStatus) => {
        qc.setQueryData(pk.oauth(st.providerId), st);
        if (st.state === "signedIn" || st.state === "signedOut") qc.invalidateQueries({ queryKey: qk.providers });
      })
      .then((u) => (cancelled ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, qc]);
  return useQuery({ queryKey: pk.oauth(id), queryFn: () => api.oauthStatus(id), enabled });
}

/** Saves discovered models on a provider and makes it the app default when none is set yet. */
export async function storeModels(provider: Provider, models: string[], defaultModel?: string): Promise<Provider> {
  const saved = await api.saveProvider({
    ...provider,
    config: { ...provider.config, models, defaultModel: defaultModel ?? pickDefaultModel(models, provider.config.defaultModel) },
  });
  await ensureAppDefault(saved);
  return saved;
}

export async function ensureAppDefault(p: Provider) {
  const model = p.config.defaultModel;
  if (!model) return;
  const settings = await api.getSettings();
  const current = settings.defaultModel as ModelRef | null | undefined;
  const providers = await api.listProviders();
  if (current && providers.some((x) => x.id === current.providerId)) return;
  await api.setSetting("defaultModel", { providerId: p.id, model } satisfies ModelRef);
}
