import { useEffect, useState } from "react";
import { Input } from "../../../components/ui/input";
import { ErrorState, Skeleton, Switch } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";
import { useSettings } from "../../../lib/queries";
import { cn } from "../../../lib/utils";
import { SettingsRow } from "../layout";

const MIN_MINUTES = 15;
const MAX_MINUTES = 300;

export function parseHyperfocusMinutes(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= MIN_MINUTES && n <= MAX_MINUTES ? n : null;
}

export function HyperfocusSettings({ part = "switch" }: { part?: "switch" | "minutes" }) {
  const { prefs, isLoading, error } = useFocusPrefs();
  const { refetch } = useSettings();
  const setPref = useSetFocusPref();
  const hf = prefs.hyperfocus;
  const [text, setText] = useState(String(hf.minutes));

  useEffect(() => setText(String(hf.minutes)), [hf.minutes]);

  if (part === "minutes" && (isLoading || error)) return null;
  if (isLoading) return <Skeleton className="my-3 h-12" />;
  if (error) return <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />;

  const parsed = parseHyperfocusMinutes(text);
  const save = async (next: typeof hf) => {
    try {
      await setPref("hyperfocus", next);
    } catch (e) {
      toastError(s.focus.hyperfocus.saveFailed, e, () => void save(next));
    }
  };

  if (part === "switch")
    return (
      <div data-testid="hyperfocus-settings">
        <SettingsRow title={s.focus.hyperfocus.settingTitle} description={s.focus.hyperfocus.settingHelp}>
          <Switch
            label={s.focus.hyperfocus.settingTitle}
            checked={hf.enabled}
            onCheckedChange={(enabled) => void save({ ...hf, enabled })}
          />
        </SettingsRow>
      </div>
    );

  return (
    <>
      {hf.enabled && (
        <SettingsRow
          title={<label htmlFor="hyperfocus-minutes">{s.focus.hyperfocus.minutes}</label>}
          description={
            <span id="hyperfocus-minutes-help" className={cn(parsed == null && "text-danger")}>
              {parsed == null ? s.focus.hyperfocus.minutesInvalid : s.focus.hyperfocus.minutesHelp}
            </span>
          }
        >
          <Input
            id="hyperfocus-minutes"
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={1}
            value={text}
            aria-invalid={parsed == null}
            aria-describedby="hyperfocus-minutes-help"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (parsed != null && parsed !== hf.minutes) void save({ ...hf, minutes: parsed });
            }}
            className={cn("h-7.5 w-20 text-right", parsed == null && "border-danger")}
          />
        </SettingsRow>
      )}
    </>
  );
}
