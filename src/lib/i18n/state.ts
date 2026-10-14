import { useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, localeInfo } from "./locales";

let current = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export const getLocale = () => current;

export function setCurrentLocale(code: string) {
  current = code;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.lang = code;
    root.dir = localeInfo(code).dir;
  }
  listeners.forEach((l) => l());
}

export function subscribeLocale(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const useLocale = () => useSyncExternalStore(subscribeLocale, getLocale, getLocale);
