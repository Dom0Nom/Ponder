import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { s } from "./strings";

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

export function formatMinutes(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}

export function relativeTime(ts: number, now = Date.now()): string {
  if (ts - now > 60_000) {
    const m = Math.round((ts - now) / 60_000);
    if (m < 60) return `in ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `in ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "tomorrow" : `in ${d} days`;
  }
  const diff = now - ts;
  const min = 60_000;
  if (diff < min) return "just now";
  if (diff < 60 * min) return `${Math.floor(diff / min)} min ago`;
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} h ago`;
  const days = Math.floor(diff / (24 * 60 * min));
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

export function relativeShort(ts: number, now = Date.now()): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return new Date(ts).toLocaleDateString();
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
