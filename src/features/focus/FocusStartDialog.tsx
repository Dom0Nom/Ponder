import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/input";
import { Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import type { FocusConfig, FocusTechnique } from "../../lib/types";
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

const toText = (o: Partial<Record<Field, number>>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as Partial<Record<Field, string>>;

export function FocusStartDialog() {
  const open = useUi((st) => st.focusDialogOpen);
  const setOpen = useUi((st) => st.setFocusDialogOpen);
  const route = useUi((st) => st.route);
  const active = useFocusStore((st) => st.state);
  const setState = useFocusStore((st) => st.setState);

  const [technique, setTechnique] = useState<FocusTechnique>("pomodoro");
  const [goal, setGoal] = useState("");
  const [values, setValues] = useState<Partial<Record<Field, string>>>(toText(FIELDS.pomodoro));
  const [checkIn, setCheckIn] = useState("15");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setGoal("");
  }, [open]);

  const pick = (t: FocusTechnique) => {
    setTechnique(t);
    setValues(toText(FIELDS[t]));
  };

  const fields = Object.keys(FIELDS[technique]) as Field[];
  const invalid = (v: string | undefined) => !(Number(v) > 0);
  const checkInInvalid = !(Number(checkIn) >= 0) || checkIn.trim() === "";
  const hasErrors = fields.some((f) => invalid(values[f])) || checkInInvalid;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (hasErrors || busy || active) return;
    const config: FocusConfig = {
      spaceId: route.name === "space" ? route.spaceId : null,
      technique,
      goal: goal.trim() || null,
      checkInMins: Math.round(Number(checkIn)),
    };
    for (const f of fields) config[f] = Number(values[f]);
    setBusy(true);
    try {
      setState(await api.focusStart(config));
      setOpen(false);
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
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={hasErrors || busy || !!active} onClick={() => void submit()}>
            {busy && <Spinner size={14} className="text-on-accent" />}
            {busy ? s.focus.starting : s.focus.begin}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5 pb-2">
        {active && (
          <p role="status" className="rounded-xl bg-warn-soft px-3 py-2 text-[0.8125rem] text-warn">
            {s.focus.alreadyRunning}
          </p>
        )}
        <fieldset>
          <legend className="mb-2 text-[0.8125rem] font-medium text-muted">{s.focus.technique}</legend>
          <div role="radiogroup" aria-label={s.focus.technique} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TECHNIQUES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={technique === t}
                onClick={() => pick(t)}
                className={cn(
                  "rounded-2xl border px-3 py-2.5 text-left transition-colors",
                  technique === t
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-border bg-surface hover:bg-surface-2",
                )}
              >
                <span className="block text-sm font-semibold">{s.focus.techniques[t]}</span>
                <span className={cn("mt-0.5 block text-xs", technique === t ? "text-accent-text/80" : "text-muted")}>
                  {s.focus.techniqueHelp[t]}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="focus-goal">{s.focus.goal}</Label>
          <Input
            id="focus-goal"
            value={goal}
            placeholder={s.focus.goalPlaceholder}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {fields.map((f) => (
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
                className={cn(invalid(values[f]) && "border-danger")}
              />
            </div>
          ))}
          <div>
            <Label htmlFor="focus-checkin">{s.focus.checkIn}</Label>
            <Input
              id="focus-checkin"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={checkIn}
              aria-invalid={checkInInvalid}
              aria-describedby="focus-checkin-help"
              onChange={(e) => setCheckIn(e.target.value)}
              className={cn(checkInInvalid && "border-danger")}
            />
            <p id="focus-checkin-help" className="mt-1 text-xs text-faint">
              {s.focus.checkInOff}
            </p>
          </div>
        </div>
        {hasErrors && <p className="text-xs text-danger">{s.focus.minutesInvalid}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
