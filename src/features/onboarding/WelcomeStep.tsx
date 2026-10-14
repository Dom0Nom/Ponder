import { PonderMark } from "../../components/brand/PonderMark";
import { Segmented, Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { changeLocale } from "../../lib/i18n/init";
import { LOCALES } from "../../lib/i18n/locales";
import { useLocale } from "../../lib/i18n/state";
import { s } from "../../lib/strings";
import { useUi, type FontPref, type ThemePref } from "../../stores/ui";
import { SettingsGroup, SettingsRow } from "../settings/layout";
import { NativeSelect } from "../settings/NativeSelect";
import { Heading } from "./parts";

export function WelcomeStep() {
  const ui = useUi();
  const locale = useLocale();
  return (
    <>
      <div className="flex flex-col items-center gap-4 pt-4">
        <PonderMark size={96} state="idle" />
        <Heading title={s.onboarding.welcome.title} body={s.onboarding.welcome.body} center />
      </div>
      <SettingsGroup>
        <SettingsRow title={s.onboarding.welcome.language}>
          <NativeSelect
            aria-label={s.onboarding.welcome.language}
            className="w-56"
            value={locale}
            onChange={(e) => changeLocale(e.target.value).catch((err) => toastError(s.errors.generic, err))}
          >
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </SettingsRow>
        <SettingsRow title={s.onboarding.welcome.theme}>
          <Segmented<ThemePref>
            label={s.onboarding.welcome.theme}
            value={ui.theme}
            onChange={ui.setTheme}
            options={(["system", "light", "dark"] as const).map((v) => ({ value: v, label: s.settings.themes[v] }))}
          />
        </SettingsRow>
        <SettingsRow title={s.onboarding.welcome.font}>
          <Segmented<FontPref>
            label={s.onboarding.welcome.font}
            value={ui.font}
            onChange={ui.setFont}
            options={(["default", "dyslexic"] as const).map((v) => ({ value: v, label: s.settings.fonts[v] }))}
          />
        </SettingsRow>
        <SettingsRow title={s.onboarding.welcome.motion} description={s.onboarding.welcome.motionHelp}>
          <Switch label={s.onboarding.welcome.motion} checked={ui.reduceMotion} onCheckedChange={ui.setReduceMotion} />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
