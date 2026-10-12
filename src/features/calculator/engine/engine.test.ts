import { describe, expect, test } from "vitest";
import { Calculator } from "./index";
import { del, insert, left, markup, newEd, tok, vertical } from "./editor";
import { formatDecimal, formatFit, formatResult, formatSig10 } from "./format";
import { cells, parse } from "../lcd/layout";
import * as N from "./num";

const NORM = { notation: "NORM" as const, fix: null, mathprint: true };

function calc(keys: string, prefix: string[] = []) {
  const c = new Calculator();
  c.pressAll(["2nd", "0", "2", "clear", ...prefix]);
  c.pressAll(keys.split(" ").filter(Boolean));
  return c;
}

describe("numbers", () => {
  test("arithmetic truncates to 13 significant digits", () => {
    expect(N.t13(2 / 3)).toBe(0.6666666666666);
    expect(N.t13(0.7 - 0.1)).toBe(0.6);
    expect(N.r13(2 / 3)).toBe(0.6666666666667);
  });

  test("overflow and underflow", () => {
    expect(() => N.t13(1e100)).toThrow("OVERFLOW");
    expect(N.t13(1e-100)).toBe(0);
  });

  test("exact radicals simplify", () => {
    expect(N.sqrt(N.int(8)).q).toEqual({ n: 2, m: 1, r: 2, pi: 0 });
    expect(N.sqrt(N.div(N.int(1), N.int(2))).q).toBeUndefined();
    expect(N.mul(N.sqrt(N.int(2)), N.sqrt(N.int(3))).q).toEqual({ n: 1, m: 1, r: 6, pi: 0 });
  });

  test("findExact recovers π/4 and 2/3 from 13-digit decimals", () => {
    expect(N.findExact(0.7853981633975)).toEqual({ n: 1, m: 4, r: 1, pi: 1 });
    expect(N.findExact(0.6666666666667)).toEqual({ n: 2, m: 3, r: 1, pi: 0 });
  });
});

describe("format", () => {
  test("FLOAT shows 10 digits counting the leading zero", () => {
    expect(formatDecimal(N.t13(2 / 3), NORM)).toBe("0.666666667");
    expect(formatDecimal(3.14159265359, NORM)).toBe("3.141592654");
    expect(formatDecimal(-0.301029995664, NORM)).toBe("⁻0.301029996");
    expect(formatDecimal(1e10, NORM)).toBe("1*10^{10}");
  });

  test("FIX, SCI, ENG and restricted forms", () => {
    expect(formatDecimal(2.5, { ...NORM, fix: 0 })).toBe("3");
    expect(formatDecimal(1.005, { ...NORM, fix: 2 })).toBe("1.01");
    expect(formatDecimal(0.005, { ...NORM, notation: "SCI" })).toBe("5*10^{⁻3}");
    expect(formatDecimal(0.005, { ...NORM, notation: "SCI", mathprint: false })).toBe("5*10^⁻3");
    expect(formatDecimal(207400, { ...NORM, notation: "ENG" }, true)).toBe("207.4ᴇ3");
  });

  test("stat values show 10 significant digits; data cells fit 6 characters", () => {
    expect(formatSig10(0.677325189641, NORM)).toBe("0.6773251896");
    expect(formatSig10(-18.666373213, NORM)).toBe("⁻18.66637321");
    expect(formatSig10(52.5, NORM)).toBe("52.5");
    expect(formatFit(18.58651222, NORM, 6)).toBe("18.587");
  });

  test("exact results and conversions", () => {
    expect(formatResult(N.div(N.int(9), N.int(2)), NORM, { hint: "mixed" })).toBe("4\\f{1}{2}");
    expect(formatResult(N.div(N.int(9), N.int(2)), { ...NORM, mathprint: false }, { hint: "mixed" })).toBe("4␣1⁄2");
    expect(formatResult(N.dec(1.5), NORM, { hint: "dms" })).toBe("1°30'0\"");
    expect(formatResult(N.mul(N.int(2), N.PI), NORM)).toBe("2π");
  });
});

describe("editor", () => {
  test("typing in the middle overwrites unless insert is on", () => {
    const ed = newEd([tok("1"), tok("2"), tok("3")]);
    left(ed);
    left(ed);
    insert(ed, [tok("9")]);
    expect(markup(ed.els)).toBe("193");
    ed.ins = true;
    insert(ed, [tok("8")]);
    expect(markup(ed.els)).toBe("1983");
  });

  test("delete at the end removes the last element", () => {
    const ed = newEd([tok("1"), tok("2")]);
    del(ed);
    expect(markup(ed.els)).toBe("1");
  });

  test("up from a denominator returns to the end of the numerator", () => {
    const c = calc("frac 1 down 4 up 3");
    expect(c.text().lines).toEqual(["\\f{13}{4}"]);
    expect(vertical(c.state.ed, 1)).toBe(true);
  });
});

describe("display rules", () => {
  test("row placement counts cells", () => {
    expect(cells(parse("e^{.5}")) + cells(parse("1.648721271"))).toBe(14);
    expect(cells(parse("\\f{3}{4}+1\\f{7}{12}"))).toBe(7);
  });

  test("long entries scroll with overflow marks", () => {
    const c = calc("1 2 3 4 5 6 7 8 9 0 add 1 2 3 4 5 6 7 8 9");
    const [line] = c.text().lines;
    expect(line.startsWith("◂")).toBe(true);
    expect(line.endsWith("6789")).toBe(true);
  });

  test("seeded rand matches the guidebook sequence", () => {
    const c = calc("5 sto prb right 1 enter prb right 1 enter");
    expect(c.text().lines.at(-1)).toBe("\t0.000093165");
  });

  test("classic mode shows fractions only for fraction input", () => {
    const classic = ["mode", "down", "down", "down", "enter", "clear"];
    expect(calc("1 div 4 enter", classic).text().lines).toEqual(["1÷4\t0.25"]);
    expect(calc("1 frac 4 enter", classic).text().lines).toEqual(["1⁄4\t1⁄4"]);
  });

  test("function table ask-x and data editor round trip", () => {
    const c = calc("table var square enter down down right enter down enter 3 enter");
    expect(c.text().lines).toEqual(["x|y", "«3»|9", "x=3"]);
    const d = calc("data 1 frac 2 down 2 down");
    expect(d.text().lines[0]).toBe("1/2|------|------");
  });

  test("state survives serialization", () => {
    const c = calc("1 frac 3 enter 2 sto var enter");
    const back = Calculator.load(c.serialize());
    back.press("toggle");
    expect(back.text().lines.at(-1)).toBe("2◂▸\t2");
    back.pressAll(["var", "add", "1", "enter"]);
    expect(back.text().lines.at(-1)).toBe("x+1\t3");
  });
});
