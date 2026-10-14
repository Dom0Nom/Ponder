import { useEffect } from "react";
import { s } from "../../lib/strings";
import { useUi, type FontPref, type ThemePref } from "../../stores/ui";
import { Segmented, Switch } from "../../components/ui/misc";
import { Slider } from "../../components/ui/slider";
import { motionReduced, useIsDark, useReducedMotion } from "../../app/useTheme";
import { NativeSelect } from "./NativeSelect";
import { LOCALES } from "../../lib/i18n/locales";
import { useLocale } from "../../lib/i18n/state";
import { changeLocale } from "../../lib/i18n/init";
import { ProvidersSection } from "./ProvidersSection";
import { ModelPicker } from "./ModelPicker";
import { ContextSection } from "./ContextSection";
import { ResearchSection } from "./ResearchSection";
import { MemorySection } from "./MemorySection";
import { CaptureSection } from "./CaptureSection";
import { AskSection } from "./AskSection";
import { CloudSection } from "./CloudSection";
import { SearchModelSection } from "./SearchModelSection";
import { FocusPackSection } from "./FocusPackSection";
import { VoiceSection } from "./VoiceSection";
import { BackupSection } from "./BackupSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { SettingsGroup, SettingsRow, SettingsSection } from "./layout";
import { AddProviderPage } from "./AddProviderPage";
import { LanScanPage } from "./LanScanPage";
import { GrokSignInPage } from "./GrokSignInPage";
import { BreakMenuPage } from "./focus/BreakMenuPage";
import { useSettings, useSetSetting } from "../../lib/queries";
import type { ModelRef } from "../../lib/types";
import { toastError } from "../../components/ui/toast";
import lockupLight from "../../assets/brand/ponder-lockup-light.png";
import lockupDark from "../../assets/brand/ponder-lockup-dark.png";
import { version } from "../../../package.json";

function SettingsSubPage() {
  const page = useUi((st) => (st.route.name === "settings" ? st.route.page : undefined));
  if (!page) return null;
  switch (page.kind) {
    case "addProvider":
      return <AddProviderPage type={page.type} />;
    case "lanScan":
      return <LanScanPage />;
    case "grokSignIn":
      return <GrokSignInPage providerId={page.providerId} />;
    case "breakMenu":
      return <BreakMenuPage />;
  }
}

function About() {
  const dark = useIsDark();
  return (
    <SettingsSection id="settings-about" title={s.settings.about}>
      <div className="flex items-center gap-4 rounded-card border border-border p-4">
        <img src={dark ? lockupDark : lockupLight} alt={s.appName} className="h-24 w-auto" />
        <p className="text-body text-muted">{s.settings.version(version)}</p>
      </div>
    </SettingsSection>
  );
}

export function SettingsScreen() {
  const ui = useUi();
  const locale = useLocale();
  const reduced = useReducedMotion();
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const section = ui.route.name === "settings" ? ui.route.section : undefined;
  const page = ui.route.name === "settings" ? ui.route.page : undefined;
  useEffect(() => {
    if (!page && section) document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: motionReduced() ? "auto" : "smooth" });
  }, [section, page]);
  if (page) return <SettingsSubPage />;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[800px] flex-col gap-5 px-10 pb-12 pt-10">
        <h1 className="text-page font-semibold">{s.settings.title}</h1>
        <SettingsSection id="settings-appearance" title={s.settings.appearance}>
          <SettingsGroup>
            <SettingsRow title={s.settings.theme}>
              <Segmented<ThemePref>
                label={s.settings.theme}
                value={ui.theme}
                onChange={ui.setTheme}
                options={(["system", "light", "dark"] as const).map((v) => ({ value: v, label: s.settings.themes[v] }))}
              />
            </SettingsRow>
            <SettingsRow title={s.settings.language}>
              <NativeSelect
                aria-label={s.settings.language}
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
            <SettingsRow title={s.settings.font}>
              <Segmented<FontPref>
                label={s.settings.fontOptions}
                value={ui.font}
                onChange={ui.setFont}
                options={(["default", "dyslexic"] as const).map((v) => ({ value: v, label: s.settings.fonts[v] }))}
              />
            </SettingsRow>
            <SettingsRow title={s.settings.textSize}>
              <Slider
                label={s.settings.textSize}
                value={ui.textScale}
                min={0.875}
                max={1.375}
                step={0.0625}
                onChange={ui.setTextScale}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>
        <SettingsSection id="settings-focus" title={s.settings.focusPack} body={s.settings.focusPackBody}>
          <FocusPackSection />
        </SettingsSection>
        <SettingsSection id="settings-capture" title={s.capture.settingsTitle} body={s.capture.settingsBody}>
          <CaptureSection />
        </SettingsSection>
        <SettingsSection id="settings-ask" title={s.ask.settingsTitle} body={s.ask.settingsBody}>
          <AskSection />
        </SettingsSection>
        <SettingsSection id="settings-memory" title={s.memory.title} body={s.memory.body}>
          <MemorySection />
        </SettingsSection>
        <SettingsSection id="settings-model" title={s.settings.defaultModel}>
          <ModelPicker
            className="w-80"
            value={(settings?.defaultModel as ModelRef | undefined) ?? null}
            onChange={(v) =>
              setSetting.mutate({ key: "defaultModel", value: v }, { onError: (e) => toastError(s.errors.generic, e) })
            }
          />
        </SettingsSection>
        <SettingsSection id="settings-research" title={s.research.settingsTitle} body={s.research.settingsBody}>
          <ResearchSection />
        </SettingsSection>
        <SettingsSection id="settings-context" title={s.context.settings.title} body={s.context.settings.body}>
          <ContextSection />
        </SettingsSection>
        <SettingsSection id="settings-providers" title={s.settings.providers} body={s.settings.providersBody}>
          <ProvidersSection />
        </SettingsSection>
        <SettingsSection id="settings-cloud" title={s.cloud.sectionTitle} body={s.cloud.sectionBody}>
          <CloudSection />
        </SettingsSection>
        <SettingsSection id="settings-search" title={s.searchModel.title} body={s.searchModel.body}>
          <SearchModelSection />
        </SettingsSection>
        <SettingsSection id="settings-voice" title={s.speech.settingsTitle} body={s.speech.settingsBody}>
          <VoiceSection />
        </SettingsSection>
        <SettingsSection id="settings-motion" title={s.settings.motion}>
          <SettingsGroup>
            <SettingsRow title={s.settings.reduceMotion}>
              <Switch checked={ui.reduceMotion} onCheckedChange={ui.setReduceMotion} label={s.settings.reduceMotion} />
            </SettingsRow>
            <SettingsRow title={s.settings.visualEffects}>
              <Switch
                checked={ui.visualEffects && !reduced}
                disabled={reduced}
                onCheckedChange={ui.setVisualEffects}
                label={s.settings.visualEffects}
              />
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>
        <SettingsSection id="settings-backups" title={s.backup.title} body={s.backup.body}>
          <BackupSection />
        </SettingsSection>
        <SettingsSection id="settings-integrations" title={s.integrations.title} body={s.integrations.body}>
          <IntegrationsSection />
        </SettingsSection>
        <About />
      </div>
    </div>
  );
}
