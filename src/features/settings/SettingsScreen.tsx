import { s } from "../../lib/strings";
import { useUi, type FontPref, type ThemePref } from "../../stores/ui";
import { Segmented } from "../../components/ui/misc";
import { ProvidersSection } from "./ProvidersSection";
import { ModelPicker } from "./ModelPicker";
import { MemorySection } from "./MemorySection";
import { CaptureSection } from "./CaptureSection";
import { CloudSection } from "./CloudSection";
import { useEffect } from "react";
import { useSettings, useSetSetting } from "../../lib/queries";
import type { ModelRef } from "../../lib/types";
import { toastError } from "../../components/ui/toast";

function Section({ title, body, children, id }: { title: string; body?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-[var(--radius-pane)] bg-surface p-6 shadow-card">
      <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

export function SettingsScreen() {
  const ui = useUi();
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const section = ui.route.name === "settings" ? ui.route.section : undefined;
  useEffect(() => {
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "smooth" });
  }, [section]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-8 pb-16 pt-6">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{s.settings.title}</h1>
        <Section title={s.settings.appearance}>
          <Row label={s.settings.theme}>
            <Segmented<ThemePref>
              label={s.settings.theme}
              value={ui.theme}
              onChange={ui.setTheme}
              options={(["system", "light", "dark"] as const).map((v) => ({ value: v, label: s.settings.themes[v] }))}
            />
          </Row>
          <Row label={s.settings.font}>
            <Segmented<FontPref>
              label={s.settings.font}
              value={ui.font}
              onChange={ui.setFont}
              options={(["inter", "dyslexic"] as const).map((v) => ({ value: v, label: s.settings.fonts[v] }))}
            />
          </Row>
          <Row label={s.settings.textSize}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.875}
                max={1.375}
                step={0.0625}
                value={ui.textScale}
                aria-label={s.settings.textSize}
                onChange={(e) => ui.setTextScale(Number(e.target.value))}
                className="w-40 accent-[var(--accent)]"
              />
              <span className="w-10 text-right text-sm tabular-nums text-muted">{Math.round(ui.textScale * 100)}%</span>
            </div>
          </Row>
        </Section>
        <Section id="settings-capture" title={s.capture.settingsTitle} body={s.capture.settingsBody}>
          <CaptureSection />
        </Section>
        <Section id="settings-memory" title={s.memory.title} body={s.memory.body}>
          <MemorySection />
        </Section>
        <Section title={s.settings.defaultModel}>
          <ModelPicker
            value={(settings?.defaultModel as ModelRef | undefined) ?? null}
            onChange={(v) =>
              setSetting.mutate({ key: "defaultModel", value: v }, { onError: (e) => toastError(s.errors.generic, e) })
            }
          />
        </Section>
        <Section title={s.settings.providers} body={s.settings.providersBody}>
          <ProvidersSection />
        </Section>
        <Section id="settings-cloud" title={s.cloud.sectionTitle} body={s.cloud.sectionBody}>
          <CloudSection />
        </Section>
      </div>
    </div>
  );
}
