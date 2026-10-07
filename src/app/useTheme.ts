import { useEffect, useSyncExternalStore } from "react";
import { effectsActive } from "../lib/motion";
import { useUi } from "../stores/ui";

const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Effective theme after resolving "system". */
export function useIsDark(): boolean {
  const theme = useUi((st) => st.theme);
  const systemDark = useSyncExternalStore(
    (cb) => {
      const m = mq();
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => mq().matches,
  );
  return theme === "dark" || (theme === "system" && systemDark);
}

const rmq = () => window.matchMedia("(prefers-reduced-motion: reduce)");

/** OS "reduce motion" or the app's Reduce motion setting. */
export function useReducedMotion(): boolean {
  const pref = useUi((st) => st.reduceMotion);
  const os = useSyncExternalStore(
    (cb) => {
      const m = rmq();
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => rmq().matches,
  );
  return pref || os;
}

/** Accent effects (border-beam, metal-fx). Always off when motion is reduced. */
export function useVisualEffects(): boolean {
  const on = useUi((st) => st.visualEffects);
  return effectsActive(on, useReducedMotion());
}

/** Non-hook check for event handlers and layout effects. */
export const motionReduced = () => document.documentElement.dataset.motion === "reduce" || rmq().matches;

export function useApplyAppearance() {
  const theme = useUi((st) => st.theme);
  const font = useUi((st) => st.font);
  const textScale = useUi((st) => st.textScale);
  const reduceMotion = useUi((st) => st.reduceMotion);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.font = font;
  }, [font]);

  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(textScale));
  }, [textScale]);

  useEffect(() => {
    document.documentElement.dataset.motion = reduceMotion ? "reduce" : "system";
  }, [reduceMotion]);
}
