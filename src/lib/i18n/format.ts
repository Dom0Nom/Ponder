import { getLocale } from "./state";

const cache = new Map<string, unknown>();

function memo<T>(kind: string, options: object | undefined, make: (locale: string) => T): T {
  const locale = getLocale();
  const key = `${kind}|${locale}|${JSON.stringify(options ?? {})}`;
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make(locale);
    cache.set(key, v);
  }
  return v;
}

const asDate = (d: Date | number | string) => (d instanceof Date ? d : new Date(d));

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return memo("n", options, (l) => new Intl.NumberFormat(l, options)).format(n);
}

/** `fraction` is 0..1 (0.5 prints "50%"). */
export function formatPercent(fraction: number, maximumFractionDigits = 0): string {
  return formatNumber(fraction, { style: "percent", maximumFractionDigits });
}

export function formatUnit(value: number, unit: string, unitDisplay: "short" | "narrow" | "long" = "short", maximumFractionDigits = 1): string {
  return formatNumber(value, { style: "unit", unit, unitDisplay, maximumFractionDigits });
}

export function formatCurrency(amount: number, currency = "USD", maximumFractionDigits = 2, minimumFractionDigits = 2): string {
  return formatNumber(amount, { style: "currency", currency, maximumFractionDigits, minimumFractionDigits });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return formatUnit(bytes, "byte");
  if (bytes < 1024 * 1024) return formatUnit(bytes / 1024, "kilobyte");
  if (bytes < 1024 * 1024 * 1024) return formatUnit(bytes / (1024 * 1024), "megabyte");
  return formatUnit(bytes / (1024 * 1024 * 1024), "gigabyte");
}

export function formatList(items: readonly string[], type: "conjunction" | "disjunction" | "unit" = "conjunction", style: "long" | "short" | "narrow" = "long"): string {
  return memo("l", { type, style }, (l) => new Intl.ListFormat(l, { type, style })).format(items);
}

export const DATE_SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
export const DATE_MEDIUM: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
export const DATE_NUMERIC: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
export const WEEKDAY_SHORT: Intl.DateTimeFormatOptions = { weekday: "short" };
export const WEEKDAY_DAY: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric" };
export const WEEKDAY_DATE: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
export const TIME_SHORT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export function formatDate(d: Date | number | string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return memo("d", options, (l) => new Intl.DateTimeFormat(l, options)).format(asDate(d));
}

export function formatTime(d: Date | number | string, options: Intl.DateTimeFormatOptions = { timeStyle: "short" }): string {
  return formatDate(d, options);
}

export function formatDateTime(d: Date | number | string): string {
  return formatDate(d, { dateStyle: "medium", timeStyle: "short" });
}

/** Time of day from minutes after midnight. */
export function formatClock(minutes: number): string {
  return formatTime(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60), TIME_SHORT);
}

/** Weekday name for 0 = Sunday .. 6 = Saturday. */
export function weekdayName(day: number, style: "short" | "long" = "short"): string {
  return formatDate(new Date(2023, 0, 1 + day), { weekday: style });
}

export function formatRelative(value: number, unit: Intl.RelativeTimeFormatUnit, style: "long" | "short" | "narrow" = "long", numeric: "always" | "auto" = "auto"): string {
  return memo("r", { style, numeric }, (l) => new Intl.RelativeTimeFormat(l, { style, numeric })).format(value, unit);
}

/** "1 hr 20 min" style duration from milliseconds; seconds only below one minute and only when asked for. */
export function formatDurationHuman(ms: number, display: "short" | "narrow" | "long" = "short", withSeconds = false): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (withSeconds && total < 60) return formatUnit(total, "second", display, 0);
  const mins = Math.round(total / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return formatUnit(m, "minute", display, 0);
  if (m === 0) return formatUnit(h, "hour", display, 0);
  return formatList([formatUnit(h, "hour", display, 0), formatUnit(m, "minute", display, 0)], "unit", display === "long" ? "long" : "narrow");
}

export const formatMinutesHuman = (minutes: number) => formatDurationHuman(minutes * 60_000);
