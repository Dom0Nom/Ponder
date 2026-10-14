import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { s } from "./strings";
import { DATE_NUMERIC, DATE_SHORT, WEEKDAY_SHORT, formatDate, formatDurationHuman, formatRelative } from "./i18n/format";

// custom font-size tokens must not be mistaken for text colors, or `text-label text-muted` loses its size
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["kbd", "meta", "label", "caption", "body", "body-lg", "input", "title-sm", "title", "section", "page", "code", "timer", "timer-xl"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export type DayGroup = "today" | "yesterday" | "week" | "month" | "older";

/** Local-calendar bucket: today, yesterday, <7 days, <30 days, older. Future timestamps count as today. */
export function dayGroup(ts: number, now = Date.now()): DayGroup {
  const a = new Date(now);
  const b = new Date(ts);
  const days = Math.round(
    (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  if (days < 30) return "month";
  return "older";
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  if (diff <= 60_000 && diff > -60_000) return s.common.justNow;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? -1 : 1;
  if (abs < 3_600_000) return formatRelative(sign * Math.round(abs / 60_000), "minute", "short");
  if (abs < 86_400_000) return formatRelative(sign * Math.round(abs / 3_600_000), "hour", "short");
  const days = Math.round(abs / 86_400_000);
  if (sign < 0 && days >= 7) return formatDate(ts, DATE_NUMERIC);
  return formatRelative(sign * days, "day", "short");
}

export function formatShortMinutes(ms: number): string {
  return formatDurationHuman(ms, "narrow");
}

/** "Today", "Yesterday", short weekday within a week, else "Sep 3". */
export function dayLabel(ts: number, now = Date.now()): string {
  const g = dayGroup(ts, now);
  if (g === "today") return s.shell.groups.today;
  if (g === "yesterday") return s.shell.groups.yesterday;
  return formatDate(ts, g === "week" ? WEEKDAY_SHORT : DATE_SHORT);
}

/** "just now", "5m ago", "2h ago", "Yesterday", "3d ago", else "Sep 3". */
export function shortRelative(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return s.common.justNow;
  if (diff < 3_600_000) return formatRelative(-Math.floor(diff / 60_000), "minute", "narrow");
  const g = dayGroup(ts, now);
  if (g === "today") return formatRelative(-Math.floor(diff / 3_600_000), "hour", "narrow");
  if (g === "yesterday") return s.shell.groups.yesterday;
  if (g === "week") return formatRelative(-Math.round(diff / 86_400_000), "day", "narrow");
  return formatDate(ts, DATE_SHORT);
}

export function relativeShort(ts: number, now = Date.now()): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return s.common.justNow;
  if (m < 60) return formatRelative(-m, "minute", "narrow");
  const h = Math.floor(m / 60);
  if (h < 24) return formatRelative(-h, "hour", "narrow");
  const d = Math.floor(h / 24);
  if (d < 7) return formatRelative(-d, "day", "narrow");
  if (d < 60) return formatRelative(-Math.floor(d / 7), "week", "narrow");
  return formatDate(ts, DATE_NUMERIC);
}

export function dueLabel(due: number, now = new Date()): string {
  const day = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const diff = Math.round((day(due) - day(now.getTime())) / 86_400_000);
  return diff <= 0 ? s.cards.dueToday : diff === 1 ? s.cards.dueTomorrow : s.cards.dueIn(diff);
}

export function uid(): string {
  return crypto.randomUUID();
}

/** True inside the real Tauri app (false in the browser preview / Playwright mock). */
export function isNativeApp(): boolean {
  return "__TAURI_INTERNALS__" in window && !("__MOCK_BACKEND__" in window);
}

export function tildePath(path: string, home: string): string {
  const h = home.replace(/[\\/]+$/, "");
  return h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path;
}

/** Spaced, typographic form of a simple expression ("2x-6+4=10" -> "2x − 6 + 4 = 10"); null when it needs real TeX. */
export function plainMath(text: string): string | null {
  const t = text.trim().replace(/^\$+|\$+$/g, "");
  if (/[\\^_{}]/.test(t)) return null;
  return t
    .replace(/\s*([+=<>×÷−])\s*/g, " $1 ")
    .replace(/(?<=[\w)])\s*-\s*(?=[\w(])/g, " − ")
    .replace(/(^|[=(+×÷<>−] ?)-(?=[\w(.])/g, "$1−")
    .replace(/\s+/g, " ")
    .trim();
}
