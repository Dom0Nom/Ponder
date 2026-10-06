import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatMinutes(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}

export function relativeTime(ts: number, now = Date.now()): string {
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

export function uid(): string {
  return crypto.randomUUID();
}

/** True inside the real Tauri app (false in the browser preview / Playwright mock). */
export function isNativeApp(): boolean {
  return "__TAURI_INTERNALS__" in window && !("__MOCK_BACKEND__" in window);
}
