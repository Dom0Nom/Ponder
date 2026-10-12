import { useSettings, useSetSetting } from "./queries";
import { AMBIENT_KEY, readAmbient } from "./ambient";
import type { AppInfo } from "./types";

/** Per-user ADHD focus pack preferences, stored as one settings key each. */
export interface HyperfocusPrefs {
  enabled: boolean;
  /** minutes of continuous work before the nudge */
  minutes: number;
}

export interface CheckInPrefs {
  /** minutes between study-buddy check-ins; 0 = off */
  minutes: number;
}

export interface ReadingPrefs {
  bionic: boolean;
  ruler: boolean;
}

export interface MusicPrefs {
  enabled: boolean;
  /** Spotify playlist URI or open.spotify.com link */
  playlist: string;
}

export interface DistractionPrefs {
  enabled: boolean;
  apps: AppInfo[];
  /** seconds a listed app may stay in front before the nudge */
  graceSec: number;
}

export const PREF_KEYS = {
  hyperfocus: "focus.hyperfocus",
  breakMenu: "focus.breakMenu",
  reading: "reading.aids",
  music: "focus.music",
  checkIns: "focus.checkIns",
  distraction: "focus.distraction",
  ambient: AMBIENT_KEY,
} as const;

export const DEFAULT_HYPERFOCUS: HyperfocusPrefs = { enabled: true, minutes: 90 };
export const DEFAULT_BREAK_MENU: string[] = [
  "Drink a glass of water",
  "Stretch or walk around",
  "Look out of a window",
  "Do ten slow breaths",
];
export const DEFAULT_CHECKINS: CheckInPrefs = { minutes: 15 };
export const DEFAULT_READING: ReadingPrefs = { bionic: false, ruler: false };
export const DEFAULT_MUSIC: MusicPrefs = { enabled: false, playlist: "" };
export const DEFAULT_DISTRACTION: DistractionPrefs = { enabled: false, apps: [], graceSec: 15 };

function readDistraction(v: unknown): DistractionPrefs {
  const o = obj(v, DEFAULT_DISTRACTION);
  const apps = Array.isArray(o.apps)
    ? o.apps.filter((a): a is AppInfo => !!a && typeof a.id === "string" && typeof a.name === "string")
    : [];
  return { enabled: o.enabled === true, apps, graceSec: Number.isFinite(o.graceSec) && o.graceSec > 0 ? o.graceSec : 15 };
}

const obj = <T extends object>(v: unknown, fallback: T): T =>
  v && typeof v === "object" && !Array.isArray(v) ? { ...fallback, ...(v as Partial<T>) } : fallback;

export function readPrefs(settings: Record<string, unknown> | undefined) {
  const menu = settings?.[PREF_KEYS.breakMenu];
  return {
    hyperfocus: obj(settings?.[PREF_KEYS.hyperfocus], DEFAULT_HYPERFOCUS),
    breakMenu: Array.isArray(menu) ? menu.filter((x): x is string => typeof x === "string") : DEFAULT_BREAK_MENU,
    reading: obj(settings?.[PREF_KEYS.reading], DEFAULT_READING),
    music: obj(settings?.[PREF_KEYS.music], DEFAULT_MUSIC),
    checkIns: obj(settings?.[PREF_KEYS.checkIns], DEFAULT_CHECKINS),
    distraction: readDistraction(settings?.[PREF_KEYS.distraction]),
    ambient: readAmbient(settings?.[PREF_KEYS.ambient]),
  };
}

export type FocusPrefs = ReturnType<typeof readPrefs>;

export function useFocusPrefs() {
  const { data, isLoading, error } = useSettings();
  return { prefs: readPrefs(data), isLoading, error };
}

export function useSetFocusPref() {
  const set = useSetSetting();
  return <K extends keyof typeof PREF_KEYS>(key: K, value: FocusPrefs[K]) =>
    set.mutateAsync({ key: PREF_KEYS[key], value });
}
