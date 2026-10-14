import type { LanguageModel } from "ai";
import { api } from "../ipc";
import { loadOpenRouterModels } from "../providers/openrouter";
import { callOptions, createLanguageModel, resolveModel, type CallOptionInput, type CallOptions } from "../providers/model";
import type { ModelRef, Provider, Space } from "../types";

export interface ResolvedModel {
  provider: Provider;
  modelId: string;
  model: LanguageModel;
  options: (opts: CallOptionInput) => CallOptions;
}

export class NoModelError extends Error {
  constructor() {
    super("No chat model is set up. Add a provider in Settings.");
  }
}

/** Space override → app default → first configured provider. */
export async function resolveChatModel(space?: Pick<Space, "modelOverride"> | null): Promise<ResolvedModel> {
  const [providers, settings] = await Promise.all([api.listProviders(), api.getSettings()]);
  const picked = resolveModel(
    (settings.defaultModel as ModelRef | undefined) ?? null,
    space?.modelOverride ?? null,
    providers,
  );
  if (!picked) throw new NoModelError();
  if (picked.provider.type === "openrouter") await loadOpenRouterModels().catch(() => undefined);
  return {
    provider: picked.provider,
    modelId: picked.modelId,
    model: createLanguageModel(picked.provider, picked.modelId),
    options: (o) => callOptions(picked.provider, picked.modelId, o),
  };
}

async function modelFromSetting(key: string, chat: ResolvedModel): Promise<ResolvedModel> {
  const [providers, settings] = await Promise.all([api.listProviders(), api.getSettings()]);
  const ref = settings[key] as ModelRef | undefined;
  if (!ref?.providerId || !ref.model) return chat;
  const picked = resolveModel(ref, null, providers);
  if (!picked) return chat;
  if (picked.provider.id === chat.provider.id && picked.modelId === chat.modelId) return chat;
  return {
    provider: picked.provider,
    modelId: picked.modelId,
    model: createLanguageModel(picked.provider, picked.modelId),
    options: (o) => callOptions(picked.provider, picked.modelId, o),
  };
}

/** Settings → Models → helper model (summaries, search planning), else the chat model itself. */
export function resolveHelperModel(_space: Pick<Space, "modelOverride"> | null, chat: ResolvedModel): Promise<ResolvedModel> {
  return modelFromSetting("helperModel", chat);
}

/** Settings → Models → large-context model, used when a turn doesn't fit the chat model; null if unset. */
export async function resolveLargeModel(chat: ResolvedModel): Promise<ResolvedModel | null> {
  const m = await modelFromSetting("largeContextModel", chat).catch(() => chat);
  return m === chat ? null : m;
}

export { extractJson } from "./json";
