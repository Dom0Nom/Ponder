import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { TEMPERATURE_VALUES, capabilitiesOf, offersTemperature } from "../../lib/providers/catalog";
import { controlsKey, effortLabel, modelLabel, thinkingOn } from "../../lib/providers/controls";
import { resolveModel } from "../../lib/providers/model";
import { useProviders, useSettings, useUpdateSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { ModelRef, Provider, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";

const triggerClass =
  "flex h-7 max-w-[260px] items-center gap-1.5 rounded-btn pl-2.5 pr-2 font-medium text-muted hover:bg-fill data-[state=open]:bg-fill";
const itemClass = "flex h-[34px] w-full items-center gap-2.5 rounded-item px-2.5 text-left hover:bg-fill";

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="pb-1 pl-3 pr-2.5 pt-2 text-label font-semibold text-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="mx-1.5 mb-1.5 mt-0.5 flex gap-0.5 rounded-btn border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-[26px] flex-1 rounded-kbd text-label",
              value === o.value ? "bg-fill-active font-semibold text-fg" : "font-medium text-fg hover:bg-fill",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const providerModels = (p: Provider) =>
  (p.config.models ?? (p.config.defaultModel ? [p.config.defaultModel] : [])).filter((m) => !/embed/i.test(m));

export function ModelMenu({ space }: { space: Space }) {
  const providers = useProviders();
  const settings = useSettings();
  const update = useUpdateSpace();
  const navigate = useUi((st) => st.navigate);
  const controls = useUi((st) => st.modelControls);
  const setControls = useUi((st) => st.setModelControls);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const list = providers.data ?? [];
  const current = resolveModel((settings.data?.defaultModel as ModelRef | undefined) ?? null, space.modelOverride, list);

  if (!current)
    return (
      <button className={triggerClass} onClick={() => navigate({ name: "settings", section: "providers" })}>
        {s.chat.noModelShort}
      </button>
    );

  const key = controlsKey(current.provider.id, current.modelId);
  const stored = controls[key];
  const caps = capabilitiesOf(current.provider);
  const effort = effortLabel(current.provider, stored);
  const total = list.reduce((n, p) => n + providerModels(p).length, 0);
  const q = query.trim().toLowerCase();
  const pick = (providerId: string, model: string) => {
    update.mutate({ id: space.id, patch: { modelOverride: { providerId, model } } }, { onError: (e) => toastError(s.errors.generic, e) });
    setOpen(false);
  };
  const showToggle = caps.reasoningToggle || caps.thinkingToggle;
  const hasControls = !!caps.reasoningLevels || caps.verbosity || offersTemperature(current.provider) || showToggle;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className={triggerClass} aria-label={`${modelLabel(current.modelId)} ${effort}`.trim()}>
          <span className="truncate text-fg">{modelLabel(current.modelId)}</span>
          {effort && <span className="shrink-0">{effort}</span>}
          <ChevronDown size={13} className="shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          data-testid="model-menu"
          className="t-dropdown z-50 max-h-[min(520px,var(--radix-popover-content-available-height))] w-[300px] overflow-y-auto rounded-pane border border-border bg-surface p-1 text-body text-fg shadow-popover outline-none"
        >
          {total > 12 && (
            <label className="mx-1.5 mb-1 mt-0.5 flex h-[30px] items-center gap-2 rounded-btn border border-border px-2.5 text-muted">
              <Search size={13} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={s.models.search(total)}
                aria-label={s.models.search(total)}
                className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint"
              />
            </label>
          )}
          {list.map((p) => {
            const models = providerModels(p).filter((m) => !q || m.toLowerCase().includes(q));
            if (!models.length) return null;
            return (
              <div key={p.id} role="group" aria-label={p.name}>
                <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-2">
                  <span className="flex size-[18px] items-center justify-center rounded-kbd bg-chip text-kbd font-semibold">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="font-semibold">{p.name}</span>
                </div>
                {models.map((m) => {
                  const on = p.id === current.provider.id && m === current.modelId;
                  return (
                    <button key={m} role="menuitemradio" aria-checked={on} title={m} onClick={() => pick(p.id, m)} className={itemClass}>
                      <span className="min-w-0 flex-1 truncate font-semibold">{modelLabel(m)}</span>
                      {on && <Check size={14} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {hasControls && <div className="my-1 h-px bg-divider" />}
          {caps.reasoningLevels && (
            <Segmented
              label={caps.reasoningLabel}
              value={stored?.reasoning}
              options={caps.reasoningLevels}
              onChange={(v) => setControls(key, { reasoning: v as never })}
            />
          )}
          {caps.verbosity && (
            <Segmented
              label={s.models.verbosity}
              value={stored?.verbosity}
              options={(["low", "medium", "high"] as const).map((v) => ({ value: v, label: s.models.verbosityLevels[v] }))}
              onChange={(v) => setControls(key, { verbosity: v as never })}
            />
          )}
          {offersTemperature(current.provider) && (
            <Segmented
              label={s.models.temperature}
              value={stored?.temperature != null ? String(stored.temperature) : undefined}
              options={TEMPERATURE_VALUES.map((t) => ({ value: String(t), label: t === 1 ? "1.0" : String(t) }))}
              onChange={(v) => setControls(key, { temperature: Number(v) })}
            />
          )}
          {showToggle && (
            <div className="flex h-[34px] items-center gap-2.5 rounded-item px-2.5">
              <span className="flex-1 font-semibold">{caps.thinkingToggle ? s.chat.extendedThinking : s.chat.thinkingToggle}</span>
              <Switch
                size="sm"
                label={caps.thinkingToggle ? s.chat.extendedThinking : s.chat.thinkingToggle}
                checked={thinkingOn(current.provider, stored)}
                onCheckedChange={(on) =>
                  setControls(key, { reasoning: on ? (stored?.reasoning && stored.reasoning !== "none" ? stored.reasoning : "medium") : "none" })
                }
              />
            </div>
          )}
          <div className="my-1 h-px bg-divider" />
          {space.modelOverride && (
            <button
              className={cn(itemClass, "font-medium")}
              onClick={() => {
                update.mutate({ id: space.id, patch: { modelOverride: null } }, { onError: (e) => toastError(s.errors.generic, e) });
                setOpen(false);
              }}
            >
              <RotateCcw size={14} /> {s.chat.useDefault}
            </button>
          )}
          <button
            className={cn(itemClass, "font-medium")}
            onClick={() => {
              setOpen(false);
              navigate({ name: "settings", section: "providers" });
            }}
          >
            <SlidersHorizontal size={14} /> {s.chat.manageModels}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
