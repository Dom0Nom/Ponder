import type { LanguageModel } from "ai";
import { api } from "../ipc";
import { callOptions, createLanguageModel, resolveModel } from "../providers/model";
import type { ModelRef, Provider, Space } from "../types";

export interface ResolvedModel {
  provider: Provider;
  modelId: string;
  model: LanguageModel;
  options: (opts: { thinking: boolean }) => Record<string, unknown>;
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
  return {
    provider: picked.provider,
    modelId: picked.modelId,
    model: createLanguageModel(picked.provider, picked.modelId),
    options: (o) => callOptions(picked.provider, o),
  };
}

export { extractJson } from "./json";
