import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/ipc";
import { catalog, pickDefaultModel } from "../../lib/providers/catalog";
import { testConnection } from "../../lib/providers/model";
import { qk } from "../../lib/queries";
import type { ModelRef, Provider, ProviderType } from "../../lib/types";
import { storeModels } from "../settings/providerQueries";

const PREFERRED: Partial<Record<ProviderType, RegExp[]>> = {
  openrouter: [/^deepseek\/deepseek-v4\.1-flash$/, /^anthropic\/claude-haiku-4\.5$/],
  anthropic: [/haiku/i],
  openai: [/^gpt-[\d.]+-mini$/, /mini/],
  google: [/flash/i],
};

/** The cheap, good-enough chat model for studying; falls back to the first chat model. */
export function recommendedModel(type: ProviderType, models: string[]): string | undefined {
  for (const re of PREFERRED[type] ?? []) {
    const hit = models.find((m) => re.test(m));
    if (hit) return hit;
  }
  return pickDefaultModel(models);
}

export type TestState = { state: "idle" | "testing" | "ok" | "error"; error?: string };

export function useVerify() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TestState>({ state: "idle" });
  const verify = async (p: Provider): Promise<Provider> => {
    setStatus({ state: "testing" });
    try {
      const r = await testConnection(p);
      const saved = await storeModels(p, r.models, recommendedModel(p.type, r.models) ?? r.defaultModel);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.providers }), qc.invalidateQueries({ queryKey: qk.settings })]);
      setStatus({ state: "ok" });
      return saved;
    } catch (e) {
      setStatus({ state: "error", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };
  return { status, verify, reset: () => setStatus({ state: "idle" }) };
}

export async function ensureProvider(existing: Provider[] | undefined, type: ProviderType, extra: Partial<Provider> = {}): Promise<{ provider: Provider; created: boolean }> {
  const found = existing?.find((p) => p.type === type && (extra.baseUrl == null || p.baseUrl === extra.baseUrl));
  if (found) return { provider: found, created: false };
  const entry = catalog[type];
  const provider = await api.saveProvider({ type, kind: entry.kind, name: entry.label, baseUrl: null, config: {}, ...extra });
  return { provider, created: true };
}

export async function setChosenModel(p: Provider, model: string) {
  await api.saveProvider({ ...p, config: { ...p.config, defaultModel: model } });
  await api.setSetting("defaultModel", { providerId: p.id, model } satisfies ModelRef);
}
