import { api, events } from "../ipc";
import { setLocale } from "../../locales";
import { isSupportedLocale, osLocale } from "./locales";

/** Applies the saved language (or the OS language) and follows changes made in other windows. */
export async function initLocale(): Promise<string> {
  let code = osLocale();
  try {
    const saved = (await api.getSettings()).locale;
    if (isSupportedLocale(saved)) code = saved;
  } catch {
    // the OS language stays
  }
  const applied = await setLocale(code);
  events.localeChanged((c) => void setLocale(c)).catch(() => {});
  return applied;
}

/** Saves the language and switches the UI without a restart. */
export async function changeLocale(code: string): Promise<void> {
  await api.setLocale(code);
  await setLocale(code);
}
