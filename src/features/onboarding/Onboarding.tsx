import { lazy, useEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Fx } from "../../components/fx/Fx";
import { useStayMounted } from "../../components/motion/useStayMounted";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { qk, useSettings, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { AiStep } from "./AiStep";
import { SearchStep } from "./SearchStep";
import { SpaceStep } from "./SpaceStep";
import { StudyStep } from "./StudyStep";
import { VoiceStep } from "./VoiceStep";
import { WelcomeStep } from "./WelcomeStep";
import { clampStep, OB, STEP_IDS, useOb } from "./state";

const MetalButton = lazy(() => import("../../components/fx/MetalButton"));
const STEPS = { welcome: WelcomeStep, ai: AiStep, search: SearchStep, voice: VoiceStep, space: SpaceStep, study: StudyStep };

function Wizard({ initial, onFinish }: { initial: number; onFinish: (goTo?: string) => void }) {
  const { save } = useOb();
  const [step, setStep] = useState(initial);
  const dir = useRef(1);
  const page = useRef<HTMLDivElement>(null);
  const last = step === STEP_IDS.length - 1;
  const Step = STEPS[STEP_IDS[step]];

  const go = (n: number) => {
    dir.current = n > step ? 1 : -1;
    setStep(n);
    save(OB.step, n).catch(() => {});
  };

  useEffect(() => {
    page.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [step]);

  const finish = async () => {
    try {
      await save(OB.done, true);
      await save(OB.step, null);
      const sid = (await api.getSettings())[OB.space];
      onFinish(typeof sid === "string" ? sid : undefined);
    } catch (e) {
      toastError(s.errors.generic, e, () => void finish());
    }
  };

  const next = () => (last ? void finish() : go(step + 1));
  const cont = (
    <Button variant="primary" onClick={next}>
      {last ? s.onboarding.start : s.onboarding.next}
    </Button>
  );

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-4 px-6">
        <ol aria-label={s.onboarding.progress} className="flex flex-1 items-center gap-1.5">
          {STEP_IDS.map((id, i) => (
            <li key={id} className="max-w-16 flex-1" aria-current={i === step ? "step" : undefined}>
              <button type="button" aria-label={s.onboarding.steps[id]} onClick={() => go(i)} className="flex h-4 w-full items-center">
                <span className={cn("h-1 w-full rounded-full transition-colors duration-[320ms]", i <= step ? "bg-primary" : "bg-border")} />
              </button>
            </li>
          ))}
        </ol>
        <span className="text-label text-muted" aria-live="polite">
          {s.onboarding.stepOf(step + 1, STEP_IDS.length)}
        </span>
        <Button variant="ghost-muted" size="sm" onClick={() => void finish()}>
          {s.onboarding.skipSetup}
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div
          key={step}
          ref={page}
          data-step={STEP_IDS[step]}
          className="t-page-enter mx-auto flex w-full max-w-[680px] flex-col gap-6 px-6 pb-10 pt-6"
          style={{ "--t-page-dir": `calc(${dir.current} * var(--dir-x, 1))` } as CSSProperties}
        >
          <Step goNext={next} />
        </div>
      </main>
      <footer className="flex h-16 shrink-0 items-center gap-2 border-t border-divider px-6">
        <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0}>
          {s.onboarding.back}
        </Button>
        <span className="flex-1 truncate text-center text-caption text-muted">{s.onboarding.changeLater}</span>
        {!last && (
          <Button variant="ghost-muted" onClick={next}>
            {s.onboarding.skip}
          </Button>
        )}
        {last ? <Fx needsWebGL2 fallback={cont} render={() => <MetalButton>{cont}</MetalButton>} /> : cont}
      </footer>
    </>
  );
}

export function OnboardingHost() {
  const settings = useSettings();
  const spaces = useSpaces();
  const qc = useQueryClient();
  const open = useUi((st) => st.onboardingOpen);
  const [latched, setLatched] = useState(false);
  const first = settings.isSuccess && spaces.isSuccess && !settings.data[OB.done] && (spaces.data.length === 0 || typeof settings.data[OB.step] === "number");
  useEffect(() => {
    if (first) setLatched(true);
  }, [first]);
  const show = open || latched;
  const mounted = useStayMounted(show, 250);

  const onFinish = (spaceId?: string) => {
    const ui = useUi.getState();
    ui.setOnboardingOpen(false);
    setLatched(false);
    qc.invalidateQueries({ queryKey: qk.spaces });
    qc.invalidateQueries({ queryKey: qk.settings });
    if (spaceId) {
      ui.navigate({ name: "space", spaceId });
      if (!settings.data?.[OB.tour]) setTimeout(() => useUi.getState().setTourOpen(true), 500);
    }
  };

  if (!mounted) return null;
  return (
    <section
      aria-label={s.onboarding.settings.title}
      data-testid="onboarding"
      className={cn(
        "fixed inset-0 z-30 flex flex-col bg-chrome text-fg transition-[opacity,transform] duration-[250ms]",
        show ? "opacity-100" : "pointer-events-none scale-[.98] opacity-0",
      )}
    >
      <Wizard initial={open ? 0 : clampStep(settings.data?.[OB.step])} onFinish={onFinish} />
    </section>
  );
}
