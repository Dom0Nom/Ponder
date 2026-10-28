import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Segmented, Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { useFocusPrefs, useSetFocusPref } from "../../lib/focusPrefs";
import { s } from "../../lib/strings";
import type { FocusTechnique } from "../../lib/types";
import { SettingsGroup, SettingsRow } from "../settings/layout";
import { readPermission, requestPermission, type Perm } from "./notifications";
import { Heading, sectionTitle } from "./parts";
import { OB, useOb } from "./state";

const TECHNIQUES: FocusTechnique[] = ["pomodoro", "52-17", "flowtime", "timebox"];
const MINUTES = [15, 30, 60, 90];

export function StudyStep() {
  const { settings, save } = useOb();
  const { prefs } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const [perm, setPerm] = useState<Perm>("default");

  useEffect(() => {
    readPermission().then(setPerm, () => setPerm("unavailable"));
  }, []);
  const ob = s.onboarding.study;
  const technique = (settings?.[OB.technique] as FocusTechnique | undefined) ?? "pomodoro";
  const daily = Number(settings?.[OB.daily]) || 30;
  const forced = (settings?.[OB.forcedBreaks] as { enabled?: boolean } | undefined)?.enabled !== false;
  const fail = (e: unknown) => toastError(s.errors.generic, e);

  const setDaily = async (m: number) => {
    try {
      await save(OB.daily, m);
      const sid = settings?.[OB.space];
      if (typeof sid === "string") {
        const plan = await api.getStudyPlan(sid);
        if (plan) {
          const { goal, examDate, studyDays } = plan.plan;
          await api.saveStudyPlan(sid, { goal, examDate, studyDays, weeklyMinutes: m * Math.max(1, studyDays.length) }, false, plan.tasks);
        }
      }
    } catch (e) {
      fail(e);
    }
  };

  const ask = async () => {
    try {
      setPerm(await requestPermission());
    } catch {
      setPerm("unavailable");
    }
  };

  return (
    <>
      <Heading title={ob.title} body={ob.body} />
      <SettingsGroup>
        <SettingsRow title={ob.technique}>
          <Segmented<FocusTechnique>
            label={ob.technique}
            value={technique}
            onChange={(v) => save(OB.technique, v).catch(fail)}
            options={TECHNIQUES.map((t) => ({ value: t, label: s.focus.techniques[t] }))}
          />
        </SettingsRow>
        <SettingsRow title={ob.daily}>
          <Segmented<string>
            label={ob.daily}
            value={String(daily)}
            onChange={(v) => void setDaily(Number(v))}
            options={MINUTES.map((m) => ({ value: String(m), label: ob.minutes(m) }))}
          />
        </SettingsRow>
        <SettingsRow title={ob.forcedBreaks} description={ob.forcedBreaksHelp}>
          <Switch label={ob.forcedBreaks} checked={forced} onCheckedChange={(enabled) => save(OB.forcedBreaks, { enabled }).catch(fail)} />
        </SettingsRow>
      </SettingsGroup>
      <section aria-label={ob.adhd} className="flex flex-col gap-2">
        <h2 className={sectionTitle}>{ob.adhd}</h2>
        <SettingsGroup>
          <SettingsRow title={ob.hyperfocus} description={ob.hyperfocusHelp}>
            <Switch label={ob.hyperfocus} checked={prefs.hyperfocus.enabled} onCheckedChange={(enabled) => setPref("hyperfocus", { ...prefs.hyperfocus, enabled }).catch(fail)} />
          </SettingsRow>
          <SettingsRow title={ob.checkIns} description={ob.checkInsHelp}>
            <Switch label={ob.checkIns} checked={prefs.checkIns.minutes > 0} onCheckedChange={(on) => setPref("checkIns", { minutes: on ? 15 : 0 }).catch(fail)} />
          </SettingsRow>
          <SettingsRow title={ob.bionic} description={ob.bionicHelp}>
            <Switch label={ob.bionic} checked={prefs.reading.bionic} onCheckedChange={(bionic) => setPref("reading", { ...prefs.reading, bionic }).catch(fail)} />
          </SettingsRow>
        </SettingsGroup>
      </section>
      <SettingsGroup>
        <SettingsRow title={ob.notifications} description={perm === "denied" ? ob.denied : perm === "unavailable" ? ob.unavailable : ob.notificationsHelp}>
          {perm === "granted" ? (
            <span className="font-medium text-muted">{ob.granted}</span>
          ) : (
            <Button variant="secondary" size="sm" disabled={perm !== "default"} onClick={() => void ask()}>
              {ob.allow}
            </Button>
          )}
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
