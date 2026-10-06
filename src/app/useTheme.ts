import { useEffect, useSyncExternalStore } from "react";
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

export function useApplyAppearance() {
  const theme = useUi((st) => st.theme);
  const font = useUi((st) => st.font);
  const textScale = useUi((st) => st.textScale);

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
}
