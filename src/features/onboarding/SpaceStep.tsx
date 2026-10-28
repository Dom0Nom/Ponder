import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { Segmented } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { CURRICULA, curriculumById } from "../../lib/placement/curricula";
import { qk, useSources, useSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import { getLocale } from "../../lib/i18n/state";
import { ImportDialog } from "../sources/ImportDialog";
import { NativeSelect } from "../settings/NativeSelect";
import { saveSkillGoal } from "./goalMigration";
import { Heading } from "./parts";
import { OB, useOb } from "./state";

type Goal = "exam" | "skill";
const SOURCE_TABS = [
  { tab: "file", label: () => s.onboarding.space.files },
  { tab: "url", label: () => s.onboarding.space.link },
  { tab: "youtube", label: () => s.onboarding.space.youtube },
  { tab: "gdrive", label: () => s.onboarding.space.cloud },
] as const;

export function SpaceStep() {
  const { settings, save } = useOb();
  const qc = useQueryClient();
  const sid = typeof settings?.[OB.space] === "string" ? (settings[OB.space] as string) : "";
  const { data: space } = useSpace(sid);
  const { data: sources } = useSources(sid);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Goal>("exam");
  const [goal, setGoal] = useState("");
  const [date, setDate] = useState("");
  const [curriculum, setCurriculum] = useState("");
  const [busy, setBusy] = useState(false);
  const [importTab, setImportTab] = useState<string | null>(null);
  const filled = useRef(false);
  const ob = s.onboarding.space;

  useEffect(() => {
    if (filled.current || !space) return;
    filled.current = true;
    setName(space.name);
    void (async () => {
      const [plan, saved] = await Promise.all([api.getStudyPlan(space.id), api.goalGet(space.id)]);
      if (plan?.plan.goal) {
        setKind("exam");
        setGoal(plan.plan.goal);
        setDate(plan.plan.examDate);
      } else if (saved?.kind === "skill") {
        setKind("skill");
        setGoal(saved.title);
      }
    })().catch(() => {});
  }, [space]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      let id = sid;
      if (id) await api.updateSpace(id, { name: name.trim() });
      else {
        const created = await api.createSpace({ name: name.trim(), icon: "book", color: "slate", language: getLocale() });
        id = created.id;
        await save(OB.space, id);
        const cur = curriculumById(curriculum);
        if (cur) await api.curriculumSet(id, cur.id, cur.title, cur.topics);
      }
      const minutes = Number(settings?.[OB.daily]) || 30;
      if (goal.trim() && kind === "exam" && /^\d{4}-\d{2}-\d{2}$/.test(date))
        await api.saveStudyPlan(id, { goal: goal.trim(), examDate: date, weeklyMinutes: minutes * 7, studyDays: [0, 1, 2, 3, 4, 5, 6] }, false, []);
      if (kind === "skill") await saveSkillGoal(id, goal);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.spaces }), qc.invalidateQueries({ queryKey: qk.space(id) }), qc.invalidateQueries({ queryKey: qk.goal(id) })]);
    } catch (e) {
      toastError(s.errors.generic, e, () => void submit());
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Heading title={ob.title} body={ob.body} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label htmlFor="ob-space-name">{ob.name}</Label>
          <Input id="ob-space-name" value={name} maxLength={80} placeholder={ob.namePlaceholder} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="mb-0">{ob.goal}</Label>
          <Segmented<Goal>
            label={ob.goal}
            value={kind}
            onChange={setKind}
            options={[
              { value: "exam", label: ob.goalExam },
              { value: "skill", label: ob.goalSkill },
            ]}
          />
        </div>
        <div className={kind === "exam" ? "grid grid-cols-[1fr_auto] gap-3" : undefined}>
          <div>
            <Label htmlFor="ob-goal">{ob.goalLabel}</Label>
            <Input id="ob-goal" value={goal} maxLength={200} placeholder={kind === "exam" ? ob.goalPlaceholder : ob.goalSkillPlaceholder} onChange={(e) => setGoal(e.target.value)} />
          </div>
          {kind === "exam" && (
            <div>
              <Label htmlFor="ob-date">{ob.date}</Label>
              <Input id="ob-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </div>
          )}
        </div>
        {!sid && (
          <div>
            <Label htmlFor="ob-curriculum">{ob.curriculum}</Label>
            <NativeSelect id="ob-curriculum" value={curriculum} onChange={(e) => setCurriculum(e.target.value)}>
              <option value="">{ob.none}</option>
              {CURRICULA.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div>
          <Button variant="secondary" type="submit" disabled={!name.trim() || busy}>
            {sid ? ob.save : ob.create}
          </Button>
        </div>
      </form>
      <section aria-label={ob.sources} className="flex flex-col gap-2">
        <h2 className="text-label font-semibold text-muted">{ob.sources}</h2>
        <p className="text-body text-muted">{sid ? ob.sourcesBody : ob.sourcesDisabled}</p>
        <div className="flex flex-wrap gap-2">
          {SOURCE_TABS.map((t) => (
            <Button key={t.tab} variant="secondary" disabled={!sid} onClick={() => setImportTab(t.tab)}>
              {t.label()}
            </Button>
          ))}
        </div>
        {!!sources?.length && (
          <p role="status" className="text-body font-medium" data-testid="ob-source-count">
            {ob.sourceCount(sources.length)}
          </p>
        )}
      </section>
      {space && importTab && <ImportDialog key={importTab} space={space} open initialTab={importTab} onOpenChange={(o) => !o && setImportTab(null)} />}
    </>
  );
}
