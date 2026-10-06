/** Parses "12", "1,234.5", "3/4", "-2 1/2", "45%", "12 cm", "x = 4" into a number. */
export function parseNumber(input: string): number | null {
  let s = input.trim().toLowerCase().replace(/^[a-z]\s*=\s*/, "").replace(/\$/g, "");
  if (!s) return null;
  const percent = s.endsWith("%");
  s = s.replace(/%$/, "").replace(/\s*[a-zµ°²³]+\.?$/i, "").trim();
  s = s.replace(/(\d),(\d{3})\b/g, "$1$2").replace(/,/g, ".");
  let v: number | null = null;
  const mixed = s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (mixed) v = Math.sign(Number(mixed[1]) || 1) * (Math.abs(Number(mixed[1])) + Number(mixed[2]) / Number(mixed[3]));
  else if (frac) v = Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  else if (/^-?\d*\.?\d+(e-?\d+)?$/.test(s)) v = Number(s);
  if (v == null || !Number.isFinite(v)) return null;
  return percent ? v : v;
}

/** Relative tolerance for numeric answers, so rounding to a sensible place counts. */
export function numbersMatch(given: number, expected: number): boolean {
  if (expected === 0) return Math.abs(given) < 1e-6;
  return Math.abs(given - expected) / Math.abs(expected) < 0.005 || Math.abs(given - expected) < 1e-6;
}
