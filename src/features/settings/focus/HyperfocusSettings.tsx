import { useEffect, useState } from "react";
import { Input, Label } from "../../../components/ui/input";
import { ErrorState, Skeleton, Switch } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";
import { useSettings } from "../../../lib/queries";
import { cn } from "../../../lib/utils";

const MIN_MINUTES = 15;
const MAX_MINUTES = 300;

export function parseHyperfocusMinutes(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= MIN_MINUTES && n <= MAX_MINUTES ? n : null;
}

export function HyperfocusSettings() {
  const { prefs, isLoading, error } = useFocusPrefs();
  const { refetch } = useSettings();
  const setPref = useSetFocusPref();
  const hf = prefs.hyperfocus;
  const [text, setText] = useState(String(hf.minutes));

  useEffect(() => setText(String(hf.minutes)), [hf.minutes]);

  if (isLoading) return <Skeleton className="h-20" />;
  if (error) return <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />;

  const parsed = parseHyperfocusMinutes(text);
  const save = async (next: typeof hf) => {
    try {
      await setPref("hyperfocus", next);
    } catch (e) {
      toastError(s.focus.hyperfocus.saveFailed, e, () => void save(next));
    }
  };

  return (
    <section data-testid="hyperfocus-settings">
      <div className="flex items-center justify-between gap-6 py-2.5">
        <div>
          <p className="text-sm font-medium">{s.focus.hyperfocus.settingTitle}</p>
          <p className="text-xs text-muted">{s.focus.hyperfocus.settingHelp}</p>
        </div>
        <Switch
          label={s.focus.hyperfocus.settingTitle}
          checked={hf.enabled}
          onCheckedChange={(enabled) => void save({ ...hf, enabled })}
        />
      </div>
      <div className="flex items-start justify-between gap-6 py-2.5">
        <Label htmlFor="hyperfocus-minutes" className="pt-2">
          {s.focus.hyperfocus.minutes}
        </Label>
        <div className="w-28">
          <Input
            id="hyperfocus-minutes"
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={1}
            value={text}
            disabled={!hf.enabled}
            aria-invalid={parsed == null}
            aria-describedby="hyperfocus-minutes-help"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (parsed != null && parsed !== hf.minutes) void save({ ...hf, minutes: parsed });
            }}
            className={cn(parsed == null && "border-danger")}
          />
        </div>
      </div>
      <p id="hyperfocus-minutes-help" className={cn("text-xs", parsed == null ? "text-danger" : "text-faint")}>
        {parsed == null ? s.focus.hyperfocus.minutesInvalid : s.focus.hyperfocus.minutesHelp}
      </p>
    </section>
  );
}
