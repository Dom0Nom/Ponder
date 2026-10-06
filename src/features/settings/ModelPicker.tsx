import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/misc";
import { catalog } from "../../lib/providers/catalog";
import { useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { ModelRef, Provider } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { NativeSelect } from "./NativeSelect";

const CUSTOM = "__custom__";

function modelsOf(p: Provider | undefined, current?: string): string[] {
  const list = [...(p?.config.models ?? [])];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

/** Select a provider + model. `allowDefault` adds "App default" (value null). */
export function ModelPicker({
  value,
  onChange,
  allowDefault,
}: {
  value: ModelRef | null;
  onChange: (v: ModelRef | null) => void;
  allowDefault?: boolean;
}) {
  const { data: providers, isLoading, error } = useProviders();
  const navigate = useUi((u) => u.navigate);
  const inSettings = useUi((u) => u.route.name === "settings");
  const provider = providers?.find((p) => p.id === value?.providerId);
  const models = modelsOf(provider, value?.model);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(value?.model ?? "");

  useEffect(() => {
    setDraft(value?.model ?? "");
    setCustom(!!provider && !value?.model && (provider.config.models ?? []).length === 0);
  }, [value?.providerId, value?.model, provider?.id]);

  if (isLoading) return <Skeleton className="h-10 w-full rounded-xl" />;
  if (error) return <p className="text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p>;

  if (!providers?.length) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-border px-4 py-3">
        <Bot size={18} className="shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{s.models.emptyTitle}</p>
          <p className="text-xs text-muted">{inSettings ? s.models.emptyBodySettings : s.models.emptyBody}</p>
        </div>
        {!inSettings && (
          <Button size="sm" variant="tonal" onClick={() => navigate({ name: "settings", section: "providers" })}>
            {s.palette.openSettings}
          </Button>
        )}
      </div>
    );
  }

  const pickProvider = (id: string) => {
    if (!id) return onChange(null);
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    const model = p.config.defaultModel ?? p.config.models?.[0] ?? "";
    setCustom(!model);
    onChange({ providerId: p.id, model });
  };

  const commitDraft = () => {
    if (provider && draft.trim() && draft.trim() !== value?.model) onChange({ providerId: provider.id, model: draft.trim() });
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NativeSelect aria-label={s.models.provider} value={provider?.id ?? ""} onChange={(e) => pickProvider(e.target.value)}>
        {allowDefault ? (
          <option value="">{s.models.appDefault}</option>
        ) : (
          !provider && (
            <option value="" disabled>
              {s.models.choose}
            </option>
          )
        )}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {catalog[p.type]?.label ?? p.type}
          </option>
        ))}
      </NativeSelect>
      {provider &&
        (custom || models.length === 0 ? (
          <Input
            aria-label={s.models.model}
            placeholder={s.models.customPlaceholder}
            value={draft}
            autoFocus={custom && models.length > 0}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft();
              if (e.key === "Escape" && models.length) setCustom(false);
            }}
          />
        ) : (
          <NativeSelect
            aria-label={s.models.model}
            value={value?.model ?? ""}
            onChange={(e) => {
              if (e.target.value === CUSTOM) {
                setDraft("");
                setCustom(true);
              } else onChange({ providerId: provider.id, model: e.target.value });
            }}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM}>{s.models.other}</option>
          </NativeSelect>
        ))}
    </div>
  );
}
