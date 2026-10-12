import { describe, expect, it } from "vitest";
import { findExtrema, findIntersections, findRoots } from "./analyze";
import { buildCurve, sampleCurve, valueAt } from "./curves";
import { compile, evaluate, parseEquation, type AngleMode } from "./parser";
import { sampleFn } from "./sample";
import { decimalsFor, formatTick, niceStep, ticks } from "./ticks";
import { defaultView, fromBounds, pan, screenX, screenY, toBounds, worldX, worldY, zoomAt, zoomCentered, MAX_SCALE } from "./view";

const ev = (src: string, x = 0, angle: AngleMode = "rad") => {
  const r = compile(src, angle);
  if (!r.ok) throw new Error(`${src}: ${r.error.code}`);
  return r.value.eval({ x, ans: 0 });
};
const err = (src: string) => {
  const r = compile(src);
  return r.ok ? null : r.error;
};

describe("parser precedence", () => {
  it("handles + - * / ^", () => {
    expect(ev("1+2*3")).toBe(7);
    expect(ev("(1+2)*3")).toBe(9);
    expect(ev("10-4-3")).toBe(3);
    expect(ev("8/4/2")).toBe(1);
    expect(ev("2^3^2")).toBe(512);
    expect(ev("2^3*2")).toBe(16);
  });
  it("unary minus binds below ^ and allows negative exponents", () => {
    expect(ev("-2^2")).toBe(-4);
    expect(ev("(-2)^2")).toBe(4);
    expect(ev("2^-1")).toBe(0.5);
    expect(ev("--3")).toBe(3);
    expect(ev("3*-2")).toBe(-6);
    expect(ev("-x^2", 3)).toBe(-9);
  });
  it("accepts unicode operators and **", () => {
    expect(ev("6÷3×2")).toBe(4);
    expect(ev("5−2")).toBe(3);
    expect(ev("2**3")).toBe(8);
  });
  it("reads decimals and exponents", () => {
    expect(ev(".5+1.25")).toBe(1.75);
    expect(ev("1e3")).toBe(1000);
    expect(ev("2e")).toBeCloseTo(2 * Math.E);
  });
});

describe("implicit multiplication", () => {
  it("number before variable, function, paren", () => {
    expect(ev("2x", 3)).toBe(6);
    expect(ev("3sin(x)", Math.PI / 2)).toBeCloseTo(3);
    expect(ev("2(3+1)")).toBe(8);
    expect(ev("(x+1)(x-1)", 4)).toBe(15);
    expect(ev("x(x+1)", 2)).toBe(6);
    expect(ev("2pi")).toBeCloseTo(2 * Math.PI);
    expect(ev("2xpi", 1)).toBeCloseTo(2 * Math.PI);
  });
  it("binds like multiplication, not tighter than ^", () => {
    expect(ev("2x^2", 3)).toBe(18);
    expect(ev("1/2x", 4)).toBe(2);
    expect(ev("xx", 3)).toBe(9);
  });
  it("splits letter runs into names", () => {
    expect(ev("xsin(x)", Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(ev("ex", 2)).toBeCloseTo(2 * Math.E);
    expect(ev("exp(1)")).toBeCloseTo(Math.E);
  });
});

describe("functions and constants", () => {
  it("evaluates the named functions", () => {
    expect(ev("sqrt(16)")).toBe(4);
    expect(ev("abs(-3)")).toBe(3);
    expect(ev("ln(e)")).toBe(1);
    expect(ev("log(1000)")).toBeCloseTo(3);
    expect(ev("exp(0)")).toBe(1);
    expect(ev("floor(2.7)")).toBe(2);
    expect(ev("ceil(2.1)")).toBe(3);
    expect(ev("atan(1)")).toBeCloseTo(Math.PI / 4);
    expect(ev("asin(1)")).toBeCloseTo(Math.PI / 2);
    expect(ev("acos(1)")).toBe(0);
    expect(ev("cos(pi)")).toBeCloseTo(-1);
    expect(ev("π")).toBe(Math.PI);
  });
  it("is case-insensitive and lets a function take a bare argument", () => {
    expect(ev("SIN(X)", Math.PI / 2)).toBeCloseTo(1);
    expect(ev("sin x", Math.PI / 2)).toBeCloseTo(1);
    expect(ev("sin x^2", 2)).toBeCloseTo(Math.sin(4));
    expect(ev("√4")).toBe(2);
  });
  it("honours degrees", () => {
    expect(ev("sin(90)", 0, "deg")).toBe(1);
    expect(ev("cos(90)", 0, "deg")).toBe(0);
    expect(ev("tan(45)", 0, "deg")).toBeCloseTo(1);
    expect(ev("tan(90)", 0, "deg")).toBeNaN();
    expect(ev("atan(1)", 0, "deg")).toBeCloseTo(45);
    expect(ev("asin(0.5)", 0, "deg")).toBeCloseTo(30);
    expect(ev("sin(x)", 180, "deg")).toBe(0);
  });
  it("gives NaN / Infinity outside the domain instead of throwing", () => {
    expect(ev("sqrt(-1)")).toBeNaN();
    expect(ev("ln(0)")).toBe(-Infinity);
    expect(ev("1/0")).toBe(Infinity);
  });
});

describe("errors", () => {
  it("reports the kind and position", () => {
    expect(err("")).toMatchObject({ code: "empty" });
    expect(err("   ")).toMatchObject({ code: "empty" });
    expect(err("2+")).toMatchObject({ code: "unexpectedEnd", pos: 2 });
    expect(err("(1+2")).toMatchObject({ code: "unmatchedParen", pos: 0 });
    expect(err("1+2)")).toMatchObject({ code: "unmatchedParen", pos: 3 });
    expect(err("foo(2)")).toMatchObject({ code: "unknownName", pos: 0, detail: "foo" });
    expect(err("2 $ 3")).toMatchObject({ code: "unexpected", pos: 2 });
    expect(err("*2")).toMatchObject({ code: "unexpected", pos: 0 });
    expect(err("sin")).toMatchObject({ code: "unexpectedEnd" });
    expect(err("2)(")).toMatchObject({ code: "unmatchedParen" });
  });
  it("never evaluates arbitrary code", () => {
    expect(err("alert(1)")).not.toBeNull();
    expect(err("constructor")).not.toBeNull();
    expect(err("x.y")).not.toBeNull();
  });
  it("only knows x unless told about more variables", () => {
    expect(err("y+1")).toMatchObject({ code: "unknownName" });
    expect(evaluate("ans*2", "rad", { ans: 21 })).toEqual({ ok: true, value: 42 });
  });
});

describe("equations", () => {
  it("accepts bare, y= and f(x)=", () => {
    for (const s of ["x+1", "y = x+1", "f(x)=x+1"]) {
      const r = parseEquation(s);
      expect(r.ok && r.value.kind).toBe("y");
    }
  });
  it("accepts x = c as a vertical line", () => {
    expect(parseEquation("x = 2")).toMatchObject({ ok: true, value: { kind: "x", value: 2 } });
    expect(parseEquation("x = 2pi")).toMatchObject({ ok: true, value: { kind: "x", value: 2 * Math.PI } });
    expect(parseEquation("x = x+1")).toMatchObject({ ok: false, error: { code: "notConstant" } });
  });
  it("rejects other equations and shifts error positions", () => {
    expect(parseEquation("z = 1")).toMatchObject({ ok: false, error: { code: "badEquation" } });
    expect(parseEquation("y = 1 = 2")).toMatchObject({ ok: false, error: { code: "badEquation" } });
    expect(parseEquation("y = 2+")).toMatchObject({ ok: false, error: { code: "unexpectedEnd", pos: 6 } });
  });
});

describe("ticks", () => {
  it("picks 1-2-5 steps", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.1)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.013)).toBeCloseTo(0.02);
    expect(niceStep(420)).toBe(500);
    expect(niceStep(0)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });
  it("lists multiples of the step inside the range", () => {
    expect(ticks(-1, 1, 0.5)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(ticks(0.05, 0.35, 0.1)).toEqual([0.1, 0.2, 0.3]);
    expect(ticks(-10, 10, 5)).toEqual([-10, -5, 0, 5, 10]);
  });
  it("has no float noise and refuses absurd counts", () => {
    expect(ticks(0, 1, 0.1)[3]).toBe(0.3);
    expect(ticks(0, 1e6, 1)).toEqual([]);
    expect(ticks(1, 1, 1)).toEqual([]);
  });
  it("formats labels", () => {
    expect(decimalsFor(0.1)).toBe(1);
    expect(decimalsFor(5)).toBe(0);
    expect(formatTick(0.30000000000000004, 0.1)).toBe("0.3");
    expect(formatTick(5, 5)).toBe("5");
    expect(formatTick(-2.5, 0.5)).toBe("-2.5");
    expect(formatTick(2, 0.5)).toBe("2");
    expect(formatTick(1e-13, 1)).toBe("0");
    expect(formatTick(2_000_000, 1_000_000)).toBe("2e6");
    expect(formatTick(0.00002, 0.00001)).toBe("2e-5");
  });
});

describe("view maths", () => {
  const w = 400;
  const h = 300;
  it("round-trips world and screen", () => {
    const v = { cx: 3, cy: -2, sx: 0.05, sy: 0.04 };
    expect(worldX(v, w, screenX(v, w, 1.7))).toBeCloseTo(1.7);
    expect(worldY(v, h, screenY(v, h, -4.2))).toBeCloseTo(-4.2);
    expect(screenX(v, w, 3)).toBe(w / 2);
  });
  it("converts bounds both ways", () => {
    const b = { xmin: -5, xmax: 15, ymin: -1, ymax: 2 };
    expect(toBounds(fromBounds(b, w, h), w, h)).toEqual(b);
  });
  it("default view is square with x in [-10, 10]", () => {
    const b = toBounds(defaultView(w), w, h);
    expect(b.xmin).toBeCloseTo(-10);
    expect(b.xmax).toBeCloseTo(10);
    expect(b.ymax).toBeCloseTo(7.5);
  });
  it("pan moves content with the pointer", () => {
    const v = defaultView(w);
    const p = pan(v, 40, 0);
    expect(screenX(p, w, 0)).toBeCloseTo(w / 2 + 40);
    const q = pan(v, 0, 30);
    expect(screenY(q, h, 0)).toBeCloseTo(h / 2 + 30);
  });
  it("zoomAt keeps the pointed world position fixed", () => {
    const v = { cx: 1, cy: 2, sx: 0.05, sy: 0.05 };
    const px = 120;
    const py = 70;
    const before = [worldX(v, w, px), worldY(v, h, py)];
    const z = zoomAt(v, 2, px, py, w, h);
    expect(z.sx).toBeCloseTo(0.025);
    expect(worldX(z, w, px)).toBeCloseTo(before[0]);
    expect(worldY(z, h, py)).toBeCloseTo(before[1]);
    const o = zoomAt(v, 0.5, px, py, w, h);
    expect(o.sx).toBeCloseTo(0.1);
    expect(worldX(o, w, px)).toBeCloseTo(before[0]);
  });
  it("zoomCentered keeps the centre and clamps", () => {
    const v = { cx: 1, cy: 2, sx: 0.05, sy: 0.05 };
    const z = zoomCentered(v, 4);
    expect([z.cx, z.cy]).toEqual([1, 2]);
    expect(z.sx).toBeCloseTo(0.0125);
    expect(zoomCentered(v, 1e-30).sx).toBe(MAX_SCALE);
  });
});

describe("sampling", () => {
  const span = 20;
  const ypp = span / 300;
  const run = (f: (x: number) => number, a = -10, b = 10) => sampleFn(f, a, b, 400, ypp);
  it("samples a smooth curve as one segment", () => {
    const s = run((x) => x * x / 10);
    expect(s.segments).toHaveLength(1);
    expect(s.points).toBe(401);
  });
  it("splits at tan asymptotes", () => {
    const s = run(Math.tan);
    expect(s.segments.length).toBeGreaterThanOrEqual(6);
    for (const seg of s.segments) for (let i = 2; i < seg.length; i += 2) expect(Math.abs(seg[i + 1] - seg[i - 1])).toBeLessThan(span);
  });
  it("splits 1/x at the pole", () => {
    const s = run((x) => 1 / x, -10.05, 10);
    expect(s.segments).toHaveLength(2);
  });
  it("leaves out undefined regions", () => {
    const s = run(Math.sqrt);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0][0]).toBeGreaterThanOrEqual(0);
    expect(run((x) => Math.sqrt(-1 - x * x)).segments).toHaveLength(0);
    expect(run(() => NaN).points).toBe(0);
  });
  it("breaks at jump discontinuities", () => {
    const s = run((x) => (x < 0 ? -15 : 15));
    expect(s.segments).toHaveLength(2);
  });
  it("keeps steep but continuous curves connected", () => {
    const s = run((x) => 400 * x);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0].length).toBeGreaterThan(2 * 401);
  });
  it("floor draws one flat run per step", () => {
    const s = run(Math.floor, -3, 3);
    expect(s.segments.length).toBeGreaterThanOrEqual(5);
  });
  it("works through buildCurve with degrees", () => {
    const c = buildCurve("tan(x)", "deg");
    const s = sampleCurve(c, { xmin: -180, xmax: 180, ymin: -10, ymax: 10 }, 600, 300);
    expect(s.segments.length).toBeGreaterThanOrEqual(3);
    expect(valueAt(c, 45)).toBeCloseTo(1);
  });
  it("vertical lines are one segment only when inside the view", () => {
    const b = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
    expect(sampleCurve(buildCurve("x=2", "rad"), b, 100, 100).segments).toEqual([[2, -5, 2, 5]]);
    expect(sampleCurve(buildCurve("x=9", "rad"), b, 100, 100).segments).toEqual([]);
    expect(sampleCurve(buildCurve("2+", "rad"), b, 100, 100).segments).toEqual([]);
  });
});

describe("analysis", () => {
  it("finds roots including an exact zero and ignores poles", () => {
    const r = findRoots((x) => x * x - 4, -10, 10);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(-2, 6);
    expect(findRoots((x) => x, -10, 10)).toEqual([0]);
    expect(findRoots((x) => 1 / x, -10, 10)).toEqual([]);
  });
  it("finds extrema", () => {
    const e = findExtrema((x) => x * x - 3, -10, 10);
    expect(e).toHaveLength(1);
    expect(e[0].kind).toBe("min");
    expect(e[0].y).toBeCloseTo(-3, 6);
    const s = findExtrema(Math.sin, -4, 4).map((p) => p.kind);
    expect(s).toEqual(["min", "max"]);
  });
  it("finds intersections", () => {
    const p = findIntersections((x) => x, (x) => x * x, -2, 2);
    expect(p.map((q) => Math.round(q.x * 1e6) / 1e6)).toEqual([0, 1]);
  });
});
