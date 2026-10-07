import { ListChecks, Play } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/input";
import { Segmented, Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { useFocusPrefs } from "../../lib/focusPrefs";
import { useGenerateMicroSteps } from "../../lib/focus/useGenerateMicroSteps";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import type { Energy, FocusConfig, FocusTechnique } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useFocusStore } from "./focusStore";

const TECHNIQUES: FocusTechnique[] = ["pomodoro", "52-17", "flowtime", "timebox", "custom"];

type Field = "workMins" | "breakMins" | "longBreakMins" | "cyclesBeforeLong";

const FIELDS: Record<FocusTechnique, Partial<Record<Field, number>>> = {
  pomodoro: { workMins: 25, breakMins: 5, longBreakMins: 15 },
  "52-17": {},
  flowtime: {},
  timebox: { workMins: 30, breakMins: 5 },
  custom: { workMins: 30, breakMins: 5, longBreakMins: 5, cyclesBeforeLong: 4 },
};

const FIELD_LABEL: Record<Field, string> = {
  workMins: s.focus.workMins,
  breakMins: s.focus.breakMins,
  longBreakMins: s.focus.longBreakMins,
  cyclesBeforeLong: s.focus.cycles,
};

const EDITABLE: FocusTechnique[] = ["timebox", "custom"];

const toText = (o: Partial<Record<Field, number>>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as Partial<Record<Field, string>>;

function StepsButton({
  spaceId,
  goal,
  ready,
  onNeedGoal,
  onReady,
}: {
  spaceId: string;
  goal: string;
  ready: number | null;
  onNeedGoal: () => void;
  onReady: (n: number) => void;
}) {
  const { generate, busy } = useGenerateMicroSteps(spaceId);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!goal.trim()) return onNeedGoal();
          const n = await generate(goal.trim());
          if (n) onReady(n);
        }}
        className="-ml-2.25 flex h-7.5 items-center gap-1.5 self-start rounded-btn px-2.25 font-medium hover:bg-fill disabled:opacity-60"
      >
        {busy ? <Spinner size={14} /> : <ListChecks size={14} />}
        {busy ? s.focus.micro.generating : s.focus.micro.button}
      </button>
      {ready != null && <p className="text-caption text-muted">{s.focus.micro.readyLine(ready)}</p>}
    </div>
  );
}

export function FocusStartDialog() {
  const open = useUi((st) => st.focusDialogOpen);
  const setOpen = useUi((st) => st.setFocusDialogOpen);
  const route = useUi((st) => st.route);
  const active = useFocusStore((st) => st.state);
  const setState = useFocusStore((st) => st.setState);
  const { prefs } = useFocusPrefs();

  const [technique, setTechnique] = useState<FocusTechnique>("pomodoro");
  const [goal, setGoal] = useState("");
  const [values, setValues] = useState<Partial<Record<Field, string>>>(toText(FIELDS.pomodoro));
  const [energy, setEnergy] = useState<Energy>("normal");
  const [busy, setBusy] = useState(false);
  const [stepsReady, setStepsReady] = useState<number | null>(null);
  const [needGoal, setNeedGoal] = useState(false);
  const goalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setGoal("");
      setEnergy("normal");
      setStepsReady(null);
      setNeedGoal(false);
    }
  }, [open]);

  const pick = (t: FocusTechnique) => {
    setTechnique(t);
    setValues(toText(FIELDS[t]));
  };

  const fields = Object.keys(FIELDS[technique]) as Field[];
  const shown = EDITABLE.includes(technique) ? fields : [];
  const invalid = (v: string | undefined) => !(Number(v) > 0);
  const hasErrors = fields.some((f) => invalid(values[f]));
  const spaceId = route.name === "space" ? route.spaceId : null;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (hasErrors || busy || active) return;
    const config: FocusConfig = {
      spaceId,
      technique,
      goal: goal.trim() || null,
      checkInMins: prefs.checkIns.minutes,
      energy,
    };
    for (const f of fields) config[f] = Number(values[f]);
    setBusy(true);
    try {
      setState(await api.focusStart(config));
      setOpen(false);
      if (spaceId) {
        const ui = useUi.getState();
        if (energy === "low") ui.setStudioView("lowEnergy");
        else if (stepsReady) ui.setStudioView("microsteps");
        else return;
        useUi.setState({ studioOpen: true });
      }
    } catch (err) {
      toastError(s.focus.startFailed, err, () => void submit());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={s.focus.startTitle}
      className="w-[min(482px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={hasErrors || busy || !!active} onClick={() => void submit()}>
            {busy ? <Spinner size={14} className="text-on-primary" /> : <Play size={15} />}
            {busy ? s.focus.starting : s.focus.begin}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {active && (
          <p role="status" className="rounded-control bg-fill px-3 py-2 text-body text-fg-secondary">
            {s.focus.alreadyRunning}
          </p>
        )}
        <div>
          <Label htmlFor="focus-goal">{s.focus.goal}</Label>
          <Input
            id="focus-goal"
            ref={goalRef}
            value={goal}
            placeholder={s.focus.goalPlaceholder}
            onChange={(e) => {
              setGoal(e.target.value);
              setNeedGoal(false);
            }}
            maxLength={200}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="mb-0">{s.focus.technique}</Label>
          <Segmented<FocusTechnique>
            block
            label={s.focus.technique}
            value={technique}
            onChange={pick}
            options={TECHNIQUES.map((t) => ({ value: t, label: s.focus.techniques[t] }))}
          />
          <p className="text-caption text-muted">{s.focus.techniqueHelp[technique]}</p>
          {shown.length > 0 && (
            <div className={cn("mt-1 grid gap-3", shown.length > 2 ? "grid-cols-4" : "grid-cols-2")}>
              {shown.map((f) => (
                <div key={f}>
                  <Label htmlFor={`focus-${f}`}>{FIELD_LABEL[f]}</Label>
                  <Input
                    id={`focus-${f}`}
                    type="number"
                    inputMode="decimal"
                    min={f === "cyclesBeforeLong" ? 1 : 0.5}
                    step={f === "cyclesBeforeLong" ? 1 : "any"}
                    value={values[f] ?? ""}
                    aria-invalid={invalid(values[f])}
                    onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
          {hasErrors && <p className="text-label text-danger">{s.focus.minutesInvalid}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="mb-0">{s.focus.energy}</Label>
          <Segmented<Energy>
            block
            label={s.focus.energy}
            value={energy}
            onChange={setEnergy}
            options={[
              { value: "normal", label: s.focus.energyNormal },
              { value: "low", label: s.focus.energyLow },
            ]}
          />
          {energy === "low" && <p className="text-caption text-muted">{s.focus.energyLowHelp}</p>}
        </div>
        {spaceId && (
          <>
            <StepsButton
              spaceId={spaceId}
              goal={goal}
              ready={stepsReady}
              onNeedGoal={() => {
                setNeedGoal(true);
                goalRef.current?.focus();
              }}
              onReady={setStepsReady}
            />
            {needGoal && <p className="-mt-3 text-caption text-danger">{s.focus.micro.needGoal}</p>}
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
