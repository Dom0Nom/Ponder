import { describe, expect, test } from "vitest";
import data from "../../../../docs/redesign/calculator/vectors.json";
import { Calculator } from "./index";
import { model } from "./render";
import { rasterize } from "../lcd/draw";
import { layout } from "../lcd/layout";
import { glyph } from "../lcd/font";

function run(keys: string) {
  const c = new Calculator();
  c.pressAll(data.start.reset);
  c.pressAll(keys.split(" "));
  return c;
}
const lines = (keys: string) => run(keys).text().lines;
const dots = (markup: string) => layout(markup).ops.filter((o) => o.k === "rect" && o.w === 1 && o.h === 1);
const lit = (c: Calculator, blink: boolean) => rasterize(model(c.state), blink).reduce((a, b) => a + b, 0);

describe("placeholder boxes", () => {
  test("empty fraction: two stacked boxes and the bar", () => {
    expect(lines("0 lparen 2nd frac 9 recip 0")).toEqual(["0(9^{⁻1}0\\f{}{}"]);
    const l = layout("\\f{}{}");
    expect(dots("\\f{}{}")).toHaveLength(16);
    expect(l.ops.filter((o) => o.k === "rect" && o.h === 1 && o.w > 1)).toHaveLength(1);
    const ys = dots("\\f{}{}").map((o) => o.y);
    expect(Math.min(...ys)).toBeLessThan(-8);
    expect(Math.max(...ys)).toBeGreaterThan(-3);
  });

  test("empty exponent, ×10ⁿ and eˣ: one raised box", () => {
    expect(lines("5 4 mul x10n")).toEqual(["54**10^{}"]);
    expect(dots("^{}")).toHaveLength(8);
    expect(dots("e^{}")).toHaveLength(8);
    expect(Math.max(...dots("^{}").map((o) => o.y))).toBeLessThan(-4);
  });

  test("empty denominator under a filled numerator: box under the bar", () => {
    expect(lines("lparen sub frac 2 var div 5 0 2nd frac 5")).toEqual(["(-\\f{2x÷50\\f{5}{}}{}"]);
    expect(lines("pi sub frac sto mul div 0 2nd pow 0")).toEqual(["π-\\f{→*÷\\r{0}{0}}{}"]);
    const l = layout("\\f{5}{}");
    expect(dots("\\f{5}{}")).toHaveLength(8);
    const bar = l.ops.find((o) => o.k === "rect" && o.w > 1)!;
    expect(dots("\\f{5}{}").every((o) => o.y > bar.y)).toBe(true);
    expect(l.ops.some((o) => o.k === "g" && o.key === "5")).toBe(true);
  });

  test("placeholders stay lit while the cursor blinks over them", () => {
    const c = run("frac");
    const on = lit(c, true);
    const off = lit(c, false);
    expect(off).toBeGreaterThan(0);
    expect(on).toBeGreaterThan(off - 8);
    expect(rasterize(model(c.state), true).some(Boolean)).toBe(true);
  });
});

describe("third check", () => {
  test("pow in an empty exponent nests a new empty exponent", () => {
    expect(lines(". 7 2nd ln pow")).toEqual([".7e^{^{}}"]);
    expect(dots("e^{^{}}")).toHaveLength(16);
    expect(lines("5 . 7 5 9 pow pow 6 enter")).toEqual(["", "SYNTAX", "Error"]);
  });

  test("empty templates do not pre-empt evaluation errors", () => {
    expect(lines("2 div 0 sub 1 5 2nd table 2nd log 4 frac 3 2nd square enter")).toEqual(["", "DIVIDE BY 0", "Error"]);
    const c = run("recip pow 2nd cos pow enter");
    expect(c.text().lines).toEqual(["", "DOMAIN", "Error"]);
  });

  test("a deep superscript with the cursor in it still shows its content", () => {
    const l = lines("2nd lparen square ln . . pow 8 2nd tan 0 2nd neg 2nd log lparen");
    expect(l).toHaveLength(1);
    expect(l[0].startsWith("◂^{")).toBe(true);
    expect(l[0]).toContain("8tan⁻¹(0ans10^{(}");
  });
});

describe("scroll window", () => {
  test("sin⁻¹( stays visible from its last cells after ◂", () => {
    expect(lines("2nd sin 5 mul recip sub 4 3 sub rparen 1 delete var 0")).toEqual(["◂n⁻¹(5*^{⁻1}-43-)x0"]);
  });

  test("nothing extra is kept when the window starts on a token boundary", () => {
    expect(lines("mul 7 tan 9 6 sin lparen 2nd x10n pow 1")).toEqual(["◂96sin((▸n/d◂▸Un/d^{1}"]);
  });

  test("a trailing ▸ marks content that continues to the right", () => {
    expect(lines("6 5 sto add lparen tan div recip 5 neg rparen 2nd table 2nd frac 6")).toEqual(["◂n(÷^{⁻1}5⁻)▸F◂▸d6▸"]);
  });

  test("toggle inside a superscript entry keeps the entry", () => {
    const l = lines("8 2nd square pow 2nd neg toggle 3 add 3 7 3 tan 2 7");
    expect(l).toHaveLength(1);
    expect(l[0].startsWith("◂")).toBe(true);
    expect(l[0].endsWith("◂▸3+373tan(27")).toBe(true);
  });

  test("the ⁻¹ of sin⁻¹( is one cell", () => {
    expect(glyph("⁻¹").w).toBe(5);
    expect(layout("sin⁻¹(").w).toBe(5 * 6);
  });
});

describe("errors and history", () => {
  test("an empty template is SYNTAX before any evaluation error", () => {
    expect(lines("log 8 var 2nd rparen 6 frac enter")).toEqual(["", "SYNTAX", "Error"]);
    expect(lines("2 pow enter")).toEqual(["", "SYNTAX", "Error"]);
  });

  test("a history row cut keeps the crossing token whole", () => {
    expect(lines("left square pow 3 add 2 5 2 mul tan 9 div 5 left enter")).toEqual(["(ans^{2})^{3+252*tan(}▸", "\t0"]);
  });
});

describe("glyphs", () => {
  test("the multiplication glyph is a small ×", () => {
    expect(glyph("*").rows.join("")).not.toContain("#####");
    expect(glyph("*").rows.filter((r) => r.includes("#"))).toHaveLength(3);
    expect(lines("2 mul 3")).toEqual(["2*3"]);
  });
});
