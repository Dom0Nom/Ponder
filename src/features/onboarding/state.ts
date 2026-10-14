import { useSettings, useSetSetting } from "../../lib/queries";

export const OB = {
  done: "onboardingDone",
  step: "onboardingStep",
  space: "onboardingSpaceId",
  daily: "onboardingDailyMinutes",
  technique: "focus.technique",
  forcedBreaks: "focus.forcedBreaks",
  tour: "tourDone",
} as const;

export const STEP_IDS = ["welcome", "ai", "search", "voice", "space", "study"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const clampStep = (v: unknown) => (typeof v === "number" && v >= 0 && v < STEP_IDS.length ? Math.floor(v) : 0);

export function useOb() {
  const { data } = useSettings();
  const set = useSetSetting();
  return { settings: data, save: (key: string, value: unknown) => set.mutateAsync({ key, value }) };
}

export interface StepProps {
  goNext: () => void;
}
