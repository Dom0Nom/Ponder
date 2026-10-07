import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/misc";
import { useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { ModelRef, Provider } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { NativeSelect } from "./NativeSelect";

const SEP = "\u001f";
const CUSTOM = "__custom";

function modelsOf(p: Provider | undefined, current?: string): string[] {
  const list = [...(p?.config.models ?? [])];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

/** One select over all providers' models. `allowDefault` adds "App default" (value null). */
export function ModelPicker({
  value,
  onChange,
  allowDefault,
  defaultLabel,
  className,
}: {
  value: ModelRef | null;
  onChange: (v: ModelRef | null) => void;
  allowDefault?: boolean;
  defaultLabel?: string;
  className?: string;
}) {
  const { data: providers, isLoading, error } = useProviders();
  const navigate = useUi((u) => u.navigate);
  const inSettings = useUi((u) => u.route.name === "settings");
  const provider = providers?.find((p) => p.id === value?.providerId);
  const [customProvider, setCustomProvider] = useState<string | null>(null);
  const [draft, setDraft] = useState(value?.model ?? "");

  useEffect(() => {
    setDraft(value?.model ?? "");
    setCustomProvider(provider && !value?.model && (provider.config.models ?? []).length === 0 ? provider.id : null);
  }, [value?.providerId, value?.model, provider?.id]);

  if (isLoading) return <Skeleton className={cn("h-9 rounded-control", className ?? "w-full")} />;
  if (error) return <p className="text-body text-danger">{error instanceof Error ? error.message : String(error)}</p>;

  if (!providers?.length) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-dashed border-control px-4 py-3">
        <Bot size={18} className="shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.models.emptyTitle}</p>
          <p className="text-caption text-muted">{inSettings ? s.models.emptyBodySettings : s.models.emptyBody}</p>
        </div>
        {!inSettings && (
          <Button size="sm" variant="secondary" onClick={() => navigate({ name: "settings", section: "providers" })}>
            {s.palette.openSettings}
          </Button>
        )}
      </div>
    );
  }

  const customOwner = providers.find((p) => p.id === customProvider);
  const selected = customOwner
    ? `${customOwner.id}${SEP}${CUSTOM}`
    : value
      ? `${value.providerId}${SEP}${value.model}`
      : "";

  const commitDraft = () => {
    const v = draft.trim();
    if (customOwner && v && (v !== value?.model || customOwner.id !== value?.providerId))
      onChange({ providerId: customOwner.id, model: v });
  };

  const pick = (v: string) => {
    if (!v) {
      setCustomProvider(null);
      return onChange(null);
    }
    const [pid, model] = v.split(SEP);
    if (model === CUSTOM) {
      setDraft("");
      setCustomProvider(pid);
      return;
    }
    setCustomProvider(null);
    onChange({ providerId: pid, model });
  };

  return (
    <div className={cn("flex gap-2", className ?? "w-full")}>
      <NativeSelect className="min-w-0 flex-1" aria-label={s.models.model} value={selected} onChange={(e) => pick(e.target.value)}>
        {allowDefault ? (
          <option value="">{defaultLabel ?? s.models.appDefault}</option>
        ) : (
          !value && (
            <option value="" disabled>
              {s.models.choose}
            </option>
          )
        )}
        {providers.map((p) => (
          <optgroup key={p.id} label={p.name}>
            {modelsOf(p, p.id === value?.providerId ? value?.model : undefined).map((m) => (
              <option key={m} value={`${p.id}${SEP}${m}`}>
                {m} · {p.name}
              </option>
            ))}
            <option value={`${p.id}${SEP}${CUSTOM}`}>{s.models.other}</option>
          </optgroup>
        ))}
      </NativeSelect>
      {customOwner && (
        <Input
          aria-label={s.models.customPlaceholder}
          placeholder={s.models.customPlaceholder}
          value={draft}
          autoFocus
          className="min-w-0 flex-1"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
          }}
        />
      )}
    </div>
  );
}
