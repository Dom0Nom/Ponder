import { useEffect, useState } from "react";
import { Input } from "../../../components/ui/input";
import { ErrorState, Skeleton } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { useSettings } from "../../../lib/queries";
import { s } from "../../../lib/strings";
import { cn } from "../../../lib/utils";
import { SettingsRow } from "../layout";

const MAX_MINUTES = 600;

export const parseCheckInMinutes = (text: string): number | null => {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= MAX_MINUTES ? n : null;
};

export function CheckInSettings() {
  const { prefs, isLoading, error } = useFocusPrefs();
  const { refetch } = useSettings();
  const setPref = useSetFocusPref();
  const minutes = prefs.checkIns.minutes;
  const [text, setText] = useState(String(minutes));

  useEffect(() => setText(String(minutes)), [minutes]);

  if (isLoading) return <Skeleton className="my-3 h-12" />;
  if (error) return <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />;

  const parsed = parseCheckInMinutes(text);
  const save = async (next: number) => {
    try {
      await setPref("checkIns", { minutes: next });
    } catch (e) {
      toastError(s.focus.hyperfocus.saveFailed, e, () => void save(next));
    }
  };

  return (
    <SettingsRow
      title={<label htmlFor="checkin-minutes">{s.focus.checkIn}</label>}
      description={<span id="checkin-minutes-help">{s.focus.checkInOff}</span>}
    >
      <Input
        id="checkin-minutes"
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_MINUTES}
        step={1}
        value={text}
        aria-invalid={parsed == null}
        aria-describedby="checkin-minutes-help"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (parsed != null && parsed !== minutes) void save(parsed);
        }}
        className={cn("h-7.5 w-20 text-right", parsed == null && "border-danger")}
      />
    </SettingsRow>
  );
}
