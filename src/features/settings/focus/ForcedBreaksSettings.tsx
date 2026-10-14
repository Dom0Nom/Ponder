import { Switch } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { useSetting } from "../../../lib/queries";
import { s } from "../../../lib/strings";
import { OB } from "../../onboarding/state";
import { SettingsRow } from "../layout";

export function ForcedBreaksSettings() {
  const [value, set] = useSetting<{ enabled?: boolean }>(OB.forcedBreaks);
  return (
    <SettingsRow title={s.onboarding.study.forcedBreaks} description={s.onboarding.study.forcedBreaksHelp}>
      <Switch
        label={s.onboarding.study.forcedBreaks}
        checked={value?.enabled !== false}
        onCheckedChange={(enabled) => set({ enabled }).catch((e) => toastError(s.errors.generic, e))}
      />
    </SettingsRow>
  );
}
