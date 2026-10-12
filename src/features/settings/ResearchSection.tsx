import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Input, Textarea, Label } from "../../components/ui/input";
import { Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { resolveModel } from "../../lib/providers/model";
import { useProviders, useSetSetting, useSettings } from "../../lib/queries";
import { ENGINES_KEY, engineSettings, RESEARCH_MODEL_KEY, RESEARCH_PROMPT_KEY, researchSettings, SEARXNG_KEY } from "../../lib/research/config";
import { DEFAULT_RESEARCH_SYSTEM_PROMPT } from "../../lib/research/prompts";
import { FREE_ENGINES, KEYED_ENGINES, searchKeyId, type KeyedEngine } from "../../lib/research/search";
import { supportsModelSearch } from "../../lib/research/webSearch";
import { s } from "../../lib/strings";
import type { ModelRef } from "../../lib/types";
import { SettingsGroup, SettingsRow } from "./layout";
import { ModelPicker } from "./ModelPicker";

export function ResearchSection() {
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const cfg = researchSettings(settings);
  const [draft, setDraft] = useState(cfg.systemPrompt);
  useEffect(() => setDraft(cfg.systemPrompt), [cfg.systemPrompt]);

  const save = (key: string, value: unknown) =>
    setSetting.mutate({ key, value }, { onError: (e) => toastError(s.errors.generic, e) });

  return (
    <div className="flex flex-col gap-3.5">
      <ModelPicker
        className="w-80"
        allowDefault
        defaultLabel={s.research.sameAsChat}
        value={cfg.model}
        onChange={(v) => save(RESEARCH_MODEL_KEY, v)}
      />
      <div>
        <Label htmlFor="research-system-prompt">{s.research.promptLabel}</Label>
        <Textarea
          id="research-system-prompt"
          rows={7}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const v = draft.trim();
            if (v === cfg.systemPrompt.trim()) return;
            save(RESEARCH_PROMPT_KEY, !v || v === DEFAULT_RESEARCH_SYSTEM_PROMPT ? null : draft);
          }}
          className="resize-y"
        />
        <div className="mt-2">
          <Button size="sm" variant="ghost" disabled={!cfg.customPrompt && draft === DEFAULT_RESEARCH_SYSTEM_PROMPT} onClick={() => save(RESEARCH_PROMPT_KEY, null)}>
            {s.research.resetPrompt}
          </Button>
        </div>
      </div>
      <EnginesGroup />
    </div>
  );
}

function EnginesGroup() {
  const { data: settings } = useSettings();
  const { data: providers } = useProviders();
  const setSetting = useSetSetting();
  const engines = engineSettings(settings);
  const [url, setUrl] = useState(engines.searxngUrl);
  useEffect(() => setUrl(engines.searxngUrl), [engines.searxngUrl]);

  const save = (key: string, value: unknown) =>
    setSetting.mutate({ key, value }, { onError: (e) => toastError(s.errors.generic, e) });
  const saveEngines = (patch: Record<string, boolean>) => save(ENGINES_KEY, { ...engines.free, modelSearch: engines.modelSearch, ...patch });

  const research = researchSettings(settings).model;
  const ref: ModelRef | null = research && providers?.some((p) => p.id === research.providerId) ? research : null;
  const picked = providers ? resolveModel((settings?.defaultModel as ModelRef | undefined) ?? null, ref, providers) : null;
  const supported = !!picked && supportsModelSearch(picked.provider);

  return (
    <div className="flex flex-col gap-1.5" data-testid="search-engines">
      <h3 className="text-input font-semibold">{s.research.engines.title}</h3>
      <p className="text-pretty text-body leading-[1.5] text-muted">{s.research.engines.body}</p>
      <SettingsGroup>
        {FREE_ENGINES.map((id) => (
          <SettingsRow key={id} title={s.research.engines.free[id]}>
            <Switch label={s.research.engines.free[id]} checked={engines.free[id]} onCheckedChange={(on) => saveEngines({ [id]: on })} />
          </SettingsRow>
        ))}
        <SettingsRow title={s.research.engines.searxngLabel}>
          <Input
            aria-label={s.research.engines.searxngLabel}
            value={url}
            placeholder={s.research.engines.searxngPlaceholder}
            className="w-64"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              const v = url.trim();
              if (v !== engines.searxngUrl) save(SEARXNG_KEY, v || null);
            }}
          />
        </SettingsRow>
        {KEYED_ENGINES.map((id) => (
          <KeyRow key={id} engine={id} />
        ))}
        <SettingsRow
          title={s.research.engines.modelSearch}
          description={supported ? s.research.engines.modelSearchBody(picked!.modelId) : s.research.engines.modelSearchUnsupported}
        >
          <Switch
            label={s.research.engines.modelSearch}
            checked={supported && engines.modelSearch}
            disabled={!supported}
            onCheckedChange={(on) => saveEngines({ modelSearch: on })}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function KeyRow({ engine }: { engine: KeyedEngine }) {
  const qc = useQueryClient();
  const id = searchKeyId(engine);
  const name = s.research.engines.keyed[engine];
  const has = useQuery({ queryKey: ["secret", id], queryFn: () => api.hasSecret(id) });
  const [draft, setDraft] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["secret", id] });
  const save = useMutation({
    mutationFn: () => api.setSecret(id, draft),
    onSuccess: () => {
      setDraft("");
      refresh();
      toast.success(s.research.engines.keySaved(name));
    },
    onError: (e) => toastError(s.errors.generic, e),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSecret(id),
    onSuccess: () => {
      refresh();
      toast.success(s.research.engines.keyRemoved(name));
    },
    onError: (e) => toastError(s.errors.generic, e),
  });
  return (
    <SettingsRow title={name} description={has.data ? s.research.engines.saved : undefined}>
      {has.data ? (
        <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()} aria-label={`${s.research.engines.removeKey} ${name}`}>
          {s.research.engines.removeKey}
        </Button>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) save.mutate();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            aria-label={`${name} ${s.research.engines.keyPlaceholder}`}
            placeholder={s.research.engines.keyPlaceholder}
            value={draft}
            className="w-48"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button size="sm" variant="secondary" type="submit" disabled={!draft.trim() || save.isPending} aria-label={`${s.research.engines.saveKey} ${name}`}>
            {s.research.engines.saveKey}
          </Button>
        </form>
      )}
    </SettingsRow>
  );
}
