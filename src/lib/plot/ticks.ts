/** Smallest 1, 2 or 5 times a power of ten that is >= `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return m * pow;
}

/** Step that gives roughly `target` ticks across [min, max]. */
export function tickStep(min: number, max: number, target: number): number {
  return niceStep((max - min) / Math.max(1, target));
}

export function decimalsFor(step: number): number {
  if (!(step > 0)) return 0;
  return Math.max(0, Math.min(12, -Math.floor(Math.log10(step) + 1e-9)));
}

/** Multiples of `step` inside [min, max], with float noise removed. */
export function ticks(min: number, max: number, step: number, limit = 400): number[] {
  if (!(step > 0) || !(max > min)) return [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  if (last - first > limit) return [];
  const d = decimalsFor(step);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(Number((i * step).toFixed(Math.min(d + 1, 12))));
  return out;
}

export function formatTick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-9) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || (a < 1e-4 && a > 0)) {
    const [m, e] = v.toExponential(Math.max(0, Math.min(6, decimalsFor(step) > 6 ? 3 : 2))).split("e");
    return `${m.replace(/\.?0+$/, "")}e${Number(e)}`;
  }
  return v.toFixed(decimalsFor(step)).replace(/\.0+$/, "");
}
