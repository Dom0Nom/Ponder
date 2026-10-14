import type { ModelRef } from "../../lib/types";
import { useProviders, useSetSetting, useSettings } from "../../lib/queries";
import { s } from "../../lib/strings";
import { DEFAULT_MAX_CONTEXT } from "../../lib/context/budget";
import { toastError } from "../../components/ui/toast";
import { Label } from "../../components/ui/input";
import { ModelPicker } from "./ModelPicker";
import { NativeSelect } from "./NativeSelect";

const STEPS = [32_000, 64_000, 128_000, 200_000, 400_000, 1_000_000];
const fmt = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);

/** Settings → Models: the per-message cost cap, the helper model and the large-context model. */
export function ContextSection() {
  const { data: settings } = useSettings();
  useProviders();
  const setSetting = useSetSetting();
  const save = (key: string, value: unknown) => setSetting.mutate({ key, value }, { onError: (e) => toastError(s.errors.generic, e) });
  const max = typeof settings?.maxContextTokens === "number" ? settings.maxContextTokens : DEFAULT_MAX_CONTEXT;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="max-context">{s.context.settings.maxContext}</Label>
        <NativeSelect id="max-context" className="w-48" value={String(max)} onChange={(e) => save("maxContextTokens", Number(e.target.value))}>
          {STEPS.map((n) => (
            <option key={n} value={n}>
              {fmt(n)}
            </option>
          ))}
        </NativeSelect>
        <p className="mt-1.5 text-label text-fg-secondary">{s.context.settings.maxContextHelp}</p>
      </div>
      <div>
        <Label>{s.context.settings.helperModel}</Label>
        <ModelPicker className="w-80" allowDefault defaultLabel={s.context.settings.sameAsChat} value={(settings?.helperModel as ModelRef | undefined) ?? null} onChange={(v) => save("helperModel", v)} />
        <p className="mt-1.5 text-label text-fg-secondary">{s.context.settings.helperModelHelp}</p>
      </div>
      <div>
        <Label>{s.context.settings.largeModel}</Label>
        <ModelPicker className="w-80" allowDefault defaultLabel={s.context.settings.none} value={(settings?.largeContextModel as ModelRef | undefined) ?? null} onChange={(v) => save("largeContextModel", v)} />
        <p className="mt-1.5 text-label text-fg-secondary">{s.context.settings.largeModelHelp}</p>
      </div>
    </div>
  );
}
