import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ProviderIcon } from "../../components/ProviderIcon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../../components/ui/menu";
import {
  controlsKey,
  effectiveEffort,
  effectiveThinking,
  effortLabel,
  modelCapabilities,
  modelLabel,
  sanitizeControls,
  temperatureAvailable,
  thinkingOffBlocked,
} from "../../lib/providers/controls";
import { effortRank, type Effort } from "../../lib/providers/modelCaps";
import { resolveModel } from "../../lib/providers/model";
import { authorOf } from "../../lib/providers/openrouter";
import { useOpenRouterModels, useProviders, useSettings, useUpdateSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { ModelRef, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { ModelBrowser } from "./ModelBrowser";

const triggerClass =
  "flex h-7 max-w-[260px] items-center gap-1.5 rounded-btn ps-2.5 pe-2 font-medium text-muted hover:bg-fill data-[state=open]:bg-fill";
const itemClass = "flex h-[34px] w-full items-center gap-2.5 rounded-item px-2.5 text-start hover:bg-fill";

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
      <p className="pb-1 ps-3 pe-2.5 pt-2 text-label font-semibold text-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="mx-1.5 mb-1.5 mt-0.5 flex gap-0.5 rounded-btn border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-[26px] flex-auto whitespace-nowrap rounded-kbd px-1 text-label",
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

export function ModelMenu({ space }: { space: Space }) {
  const providers = useProviders();
  const settings = useSettings();
  const update = useUpdateSpace();
  const navigate = useUi((st) => st.navigate);
  const controls = useUi((st) => st.modelControls);
  const setControls = useUi((st) => st.setModelControls);
  const pushRecent = useUi((st) => st.pushRecentModel);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);

  const list = providers.data ?? [];
  const current = resolveModel((settings.data?.defaultModel as ModelRef | undefined) ?? null, space.modelOverride, list);
  // loads the list so per-model controls are known before the menu opens
  useOpenRouterModels(current?.provider.type === "openrouter");

  if (!current)
    return (
      <button className={triggerClass} onClick={() => navigate({ name: "settings", section: "providers" })}>
        {s.chat.noModelShort}
      </button>
    );

  const key = controlsKey(current.provider.id, current.modelId);
  const caps = modelCapabilities(current.provider, current.modelId);
  const stored = sanitizeControls(caps, controls[key]);
  const effort = effortLabel(caps, stored);
  const viewed = list.find((p) => p.id === viewId) ?? current.provider;
  const pick = (providerId: string, model: string) => {
    update.mutate({ id: space.id, patch: { modelOverride: { providerId, model } } }, { onError: (e) => toastError(s.errors.generic, e) });
    pushRecent(providerId, model);
    setOpen(false);
  };
  // controls belong to the model in use, so they only show next to its own provider's list
  const own = viewed.id === current.provider.id;
  const showToggle = own && !!caps.thinking;
  const showTemperature = own && temperatureAvailable(caps, stored);
  const showLevels = own && !!caps.effort;
  const showVerbosity = own && !!caps.verbosity;
  const hasControls = showLevels || showVerbosity || showTemperature || showToggle;
  const thinking = effectiveThinking(caps, stored);
  const thinkingLabel = caps.thinking?.label ?? s.models.thinking;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = content.current;
    const target = e.target;
    if (!root || !(target instanceof HTMLElement) || !root.contains(target)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = Array.from(root.querySelectorAll<HTMLElement>("[data-nav]"));
      const i = items.indexOf(target);
      if (i === -1 && target !== root) return;
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      items[next]?.focus();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && target.tagName !== "INPUT") {
      root.querySelector<HTMLInputElement>("[data-model-search]")?.focus();
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setViewId(current.provider.id);
      }}
    >
      <Popover.Trigger asChild>
        <button className={triggerClass} aria-label={`${modelLabel(current.modelId)} ${effort}`.trim()}>
          {current.provider.type === "openrouter" && authorOf(current.modelId) ? (
            <ProviderIcon author={authorOf(current.modelId)} size={15} />
          ) : (
            <ProviderIcon type={current.provider.type} baseUrl={current.provider.baseUrl} size={15} />
          )}
          <span className="truncate text-fg">{modelLabel(current.modelId)}</span>
          {effort && <span className="shrink-0">{effort}</span>}
          <ChevronDown size={13} className="shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={content}
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          avoidCollisions
          data-testid="model-menu"
          onKeyDown={onKeyDown}
          className="t-dropdown z-50 flex max-h-[min(560px,var(--radix-popover-content-available-height))] w-[300px] flex-col overflow-hidden [&>*:not([data-list])]:shrink-0 rounded-pane border border-border bg-surface p-1 text-body text-fg shadow-popover outline-none"
        >
          <Menu>
            <MenuTrigger asChild disabled={list.length < 2}>
              <button
                aria-label={s.models.providerPicker}
                data-testid="provider-picker"
                className="mb-1 flex h-[34px] w-full items-center gap-2.5 rounded-item px-2.5 text-start font-semibold hover:bg-fill disabled:hover:bg-transparent data-[state=open]:bg-fill"
              >
                <ProviderIcon type={viewed.type} baseUrl={viewed.baseUrl} size={18} />
                <span className="min-w-0 flex-1 truncate">{viewed.name}</span>
                {list.length > 1 && <ChevronDown size={13} className="shrink-0 text-muted" />}
              </button>
            </MenuTrigger>
            <MenuContent popover align="start" className="w-[284px]">
              <MenuRadioGroup value={viewed.id} onValueChange={setViewId}>
                {list.map((p) => (
                  <MenuRadioItem key={p.id} value={p.id}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ProviderIcon type={p.type} baseUrl={p.baseUrl} size={18} />
                      <span className="truncate">{p.name}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
          <div className="mx-1.5 mb-1 h-px bg-divider" />
          <ModelBrowser
            provider={viewed}
            selected={viewed.id === current.provider.id ? current.modelId : null}
            onPick={(m) => pick(viewed.id, m)}
          />
          {hasControls && <div className="my-1 h-px bg-divider" />}
          {showLevels && caps.effort && (
            <Segmented
              label={caps.effort.label}
              value={effectiveEffort(caps, stored)}
              options={caps.effort.options}
              onChange={(v) => {
                const limit = caps.thinking?.offMaxEffort;
                const raisesAboveOff = !!limit && effortRank(v as Effort) > effortRank(limit);
                setControls(key, { effort: v as Effort, ...(raisesAboveOff && stored.thinking === false ? { thinking: true } : {}) });
              }}
            />
          )}
          {showVerbosity && caps.verbosity && (
            <Segmented
              label={s.models.verbosity}
              value={stored.verbosity ?? caps.verbosity.default ?? undefined}
              options={caps.verbosity.options}
              onChange={(v) => setControls(key, { verbosity: v as never })}
            />
          )}
          {showTemperature && caps.temperature && (
            <Segmented
              label={s.models.temperature}
              value={String(stored.temperature ?? caps.temperature.default ?? "")}
              options={caps.temperature.presets.map((t) => ({ value: String(t), label: t === 1 ? "1.0" : String(t) }))}
              onChange={(v) => setControls(key, { temperature: Number(v) })}
            />
          )}
          {showToggle && (
            <div className="flex h-[34px] items-center gap-2.5 rounded-item px-2.5">
              <span className="flex-1 font-semibold">{thinkingLabel}</span>
              <Switch
                size="sm"
                label={thinkingLabel}
                checked={thinking}
                disabled={thinking && thinkingOffBlocked(caps, stored)}
                onCheckedChange={(on) => setControls(key, { thinking: on })}
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
