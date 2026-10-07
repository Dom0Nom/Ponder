import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

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

export function formatShortMinutes(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

/** "Today", "Yesterday", short weekday within a week, else "Sep 3". */
export function dayLabel(ts: number, now = Date.now()): string {
  const g = dayGroup(ts, now);
  if (g === "today") return "Today";
  if (g === "yesterday") return "Yesterday";
  const d = new Date(ts);
  return g === "week"
    ? d.toLocaleDateString("en-US", { weekday: "short" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "just now", "5m ago", "2h ago", "Yesterday", "3d ago", else "Sep 3". */
export function shortRelative(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const g = dayGroup(ts, now);
  if (g === "today") return `${Math.floor(diff / 3_600_000)}h ago`;
  if (g === "yesterday") return "Yesterday";
  if (g === "week") return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function uid(): string {
  return crypto.randomUUID();
}

/** True inside the real Tauri app (false in the browser preview / Playwright mock). */
export function isNativeApp(): boolean {
  return "__TAURI_INTERNALS__" in window && !("__MOCK_BACKEND__" in window);
}
