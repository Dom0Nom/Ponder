import { describe, expect, it } from "vitest";
import { COLS, ROWS, enabledFns, fit, fmt, initial, press, restore, screenText, serialize, tableX, traceReadout, type ClassicState } from "./machine";

const keys = (st: ClassicState, ...ks: string[]) => ks.reduce(press, st);
const type = (st: ClassicState, s: string) => keys(st, ...s.split(""));
const y1 = (...ks: string[]) => keys(initial(), "yeq", ...ks);
const SQ = ["x", "pow", "2"];
const withY1 = (src = "X^2") => (src === "X^2" ? y1(...SQ) : y1("sqrt", "x", "rparen"));

describe("number format", () => {
  it("trims and switches to E notation", () => {
    expect(fmt(0.1 + 0.2)).toBe("0.3");
    expect(fmt(1 / 3)).toBe("0.3333333333");
    expect(fmt(12345678901)).toBe("1.23456789E10");
    expect(fmt(0.00001)).toBe("1E-5");
    expect(fmt(-2)).toBe("-2");
    expect(fmt(0)).toBe("0");
  });
});

describe("home screen", () => {
  it("evaluates with the shared parser and keeps Ans", () => {
    let st = keys(initial(), "2", "add", "3");
    expect(st.home.edit.text).toBe("2+3");
    st = press(st, "enter");
    expect(st.home.history).toEqual([{ input: "2+3", output: "5", error: false }]);
    expect(st.home.edit.text).toBe("");
    st = keys(st, "ans", "mul", "2", "enter");
    expect(st.home.history.at(-1)?.output).toBe("10");
  });
  it("maps keys to function text and 2nd alternates", () => {
    let st = keys(initial(), "sin", "pi", "rparen");
    expect(st.home.edit.text).toBe("sin(pi)");
    st = press(st, "enter");
    expect(st.home.history[0].output).toBe("0");
    st = keys(st, "2nd", "sin", "1", "rparen");
    expect(st.home.edit.text).toBe("asin(1)");
    expect(st.second).toBe(false);
    st = press(st, "enter");
    expect(st.home.history[1].output).toBe("1.570796327");
    st = keys(initial(), "2nd", "ln", "1", "rparen", "enter");
    expect(st.home.history[0].output).toBe("2.718281828");
  });
  it("shows syntax, divide and domain errors and keeps the entry", () => {
    let st = keys(initial(), "2", "add", "enter");
    expect(st.home.history[0]).toEqual({ input: "2+", output: "ERR:SYNTAX", error: true });
    expect(st.home.edit.text).toBe("2+");
    st = keys(initial(), "1", "div", "0", "enter");
    expect(st.home.history[0].output).toBe("ERR:DIVIDE BY 0");
    st = keys(initial(), "sqrt", "neg", "1", "rparen", "enter");
    expect(st.home.history[0].output).toBe("ERR:DOMAIN");
  });
  it("edits at the cursor", () => {
    let st = keys(initial(), "1", "2", "3", "left", "left", "del", "9");
    expect(st.home.edit).toEqual({ text: "923", cur: 1 });
    st = keys(st, "right", "right", "right", "del");
    expect(st.home.edit.text).toBe("92");
  });
  it("clear empties the entry, then the history", () => {
    let st = keys(initial(), "1", "enter", "2");
    st = press(st, "clear");
    expect(st.home.edit.text).toBe("");
    expect(st.home.history).toHaveLength(1);
    st = press(st, "clear");
    expect(st.home.history).toHaveLength(0);
  });
  it("up and 2nd enter recall the last entry", () => {
    let st = keys(initial(), "4", "add", "4", "enter", "up");
    expect(st.home.edit.text).toBe("4+4");
    st = keys(initial(), "7", "enter", "2nd", "enter");
    expect(st.home.edit.text).toBe("7");
  });
  it("mode toggles the angle unit used for evaluation", () => {
    let st = press(initial(), "mode");
    expect(st.angle).toBe("deg");
    st = keys(st, "sin", "9", "0", "rparen", "enter");
    expect(st.home.history[0].output).toBe("1");
  });
});

describe("Y= editor", () => {
  it("types into the selected row and moves with the arrows and enter", () => {
    let st = type(press(initial(), "yeq"), "1");
    expect(st.yeq.fns[0]).toBe("1");
    st = press(st, "down");
    expect(st.yeq.row).toBe(1);
    st = keys(st, "x", "enter");
    expect(st.yeq.fns.slice(0, 2)).toEqual(["1", "X"]);
    expect(st.yeq.row).toBe(2);
    st = keys(st, "up", "up", "up", "up");
    expect(st.yeq.row).toBe(0);
    st = press(st, "clear");
    expect(st.yeq.fns[0]).toBe("");
  });
  it("lists only rows that parse", () => {
    const st = withY1("X^2");
    expect(st.yeq.fns[0]).toBe("X^2");
    expect(enabledFns(st).map((f) => f.index)).toEqual([0]);
  });
  it("graph with a syntax error returns to the editor with a message", () => {
    let st = keys(initial(), "yeq", "x", "add", "graph");
    expect(st.screen).toBe("yeq");
    expect(st.message).toBe("ERR:SYNTAX Y1");
    st = keys(st, "del", "graph");
    expect(st.screen).toBe("graph");
  });
});

describe("WINDOW", () => {
  it("replaces a field on first key, commits on enter and moves down", () => {
    let st = press(initial(), "window");
    expect(screenText(st).lines[0].trim()).toBe("Xmin=-10");
    st = keys(st, "neg", "5", "enter");
    expect(st.win.xmin).toBe(-5);
    expect(st.winEdit.row).toBe(1);
    st = keys(st, "2", "pi", "enter");
    expect(st.win.xmax).toBeCloseTo(2 * Math.PI);
  });
  it("accepts expressions and edits in place after the first key", () => {
    let st = keys(initial(), "window", "down", "down", "down", "4", "del", "6");
    expect(st.winEdit.edit.text).toBe("6");
    st = press(st, "enter");
    expect(st.win.ymin).toBe(6);
  });
  it("rejects a bad range when graphing and stays on WINDOW", () => {
    const st = keys(initial(), "window", "5", "enter", "1", "graph");
    expect(st.screen).toBe("window");
    expect(st.message).toBe("ERR:WINDOW RANGE");
  });
  it("rejects a syntax error and does not leave", () => {
    const st = keys(initial(), "window", "1", "add", "graph");
    expect(st.screen).toBe("window");
    expect(st.message).toBe("ERR:SYNTAX");
  });
});

describe("ZOOM", () => {
  it("standard, in and out", () => {
    let st = keys(initial(), "window", "2", "enter", "8", "enter", "graph");
    st = keys(st, "zoom", "1");
    expect(st.screen).toBe("graph");
    expect(st.win).toMatchObject({ xmin: -10, xmax: 10, ymin: -10, ymax: 10 });
    st = keys(st, "zoom", "2");
    expect(st.win).toMatchObject({ xmin: -5, xmax: 5, ymin: -5, ymax: 5 });
    st = keys(st, "zoom", "3");
    expect(st.win).toMatchObject({ xmin: -10, xmax: 10 });
  });
  it("trig depends on the angle unit", () => {
    let st = keys(initial(), "zoom", "4");
    expect(st.win.xmax).toBeCloseTo(2 * Math.PI);
    expect(st.win.xscl).toBeCloseTo(Math.PI / 2);
    st = keys(initial(), "mode", "zoom", "4");
    expect(st.win).toMatchObject({ xmin: -360, xmax: 360, xscl: 90 });
  });
  it("fit scales y to the functions", () => {
    let st = keys(initial(), "yeq", "x", "square", "graph");
    st = keys(st, "zoom", "5");
    expect(st.win.ymin).toBeLessThan(0);
    expect(st.win.ymin).toBeGreaterThan(-12);
    expect(st.win.ymax).toBeCloseTo(110, 0);
  });
  it("square widens x to the display ratio", () => {
    const st = keys(initial(), "zoom", "6");
    expect(st.win.xmax - st.win.xmin).toBeCloseTo(30);
  });
});

describe("GRAPH and TRACE", () => {
  it("trace starts mid-window on the first function and reads Y", () => {
    let st = withY1("X^2");
    st = press(st, "trace");
    expect(st.screen).toBe("trace");
    expect(traceReadout(st)).toMatchObject({ label: "Y1", x: 0, y: 0 });
  });
  it("arrows move one step, clamped to the window", () => {
    let st = press(withY1("X^2"), "trace");
    st = press(st, "right");
    expect(traceReadout(st)!.x).toBeCloseTo(20 / 120);
    st = press(keys(st, ...Array(200).fill("right")), "right");
    expect(traceReadout(st)!.x).toBe(10);
    expect(traceReadout(st)!.y).toBe(100);
  });
  it("typing a number and enter jumps to X", () => {
    let st = keys(withY1("X^2"), "trace", "3", "enter");
    expect(traceReadout(st)).toMatchObject({ x: 3, y: 9, jump: null });
    st = keys(st, "2", "0", "enter");
    expect(st.message).toBe("ERR:INVALID");
    expect(traceReadout(st)!.x).toBe(3);
  });
  it("up and down switch between functions", () => {
    let st = keys(initial(), "yeq", "x", "down", "2", "x", "graph", "trace");
    expect(traceReadout(st)!.label).toBe("Y1");
    st = press(st, "down");
    expect(traceReadout(st)!.label).toBe("Y2");
    expect(traceReadout(st)!.y).toBe(0);
    st = press(st, "down");
    expect(traceReadout(st)!.label).toBe("Y1");
  });
  it("undefined values read as NaN", () => {
    const st = keys(withY1("sqrt(X)"), "trace", "neg", "4", "enter");
    expect(Number.isNaN(traceReadout(st)!.y)).toBe(true);
  });
  it("trace without a function stays on the graph with a message", () => {
    const st = press(initial(), "trace");
    expect(st.screen).toBe("graph");
    expect(st.message).toBe("ERR:NO FUNCTION");
  });
  it("clear leaves trace for graph, then graph for home", () => {
    let st = keys(withY1(), "trace", "clear");
    expect(st.screen).toBe("graph");
    st = press(st, "clear");
    expect(st.screen).toBe("home");
  });
});

describe("TABLE", () => {
  it("starts at 0 with step 1 and shows Y1", () => {
    const st = press(withY1("X^2"), "table");
    const lines = screenText(st).lines.map((l) => l.trimEnd());
    expect(lines[0]).toMatch(/X\s+Y1/);
    expect(lines[1]).toMatch(/^\s*0\s+0$/);
    expect(lines[2]).toMatch(/^\s*1\s+1$/);
    expect(lines[4]).toMatch(/^\s*3\s+9$/);
  });
  it("setup changes start and step and resets scrolling", () => {
    let st = keys(withY1("X^2"), "setup", "2", "enter", ".", "5", "enter", "table");
    expect(st.table).toMatchObject({ start: 2, step: 0.5, top: 0 });
    const lines = screenText(st).lines.map((l) => l.trimEnd());
    expect(lines[2]).toMatch(/^\s*2\.5\s+6\.25$/);
  });
  it("up and down scroll past the start in both directions", () => {
    let st = press(withY1("X^2"), "table");
    st = keys(st, "up", "up");
    expect(screenText(st).lines[1].trim()).toMatch(/^-2\s+4$/);
    st = keys(st, ...Array(10).fill("down"));
    expect(screenText(st).lines[1].trim()).toMatch(/^8\s+64$/);
  });
  it("shows ERROR where undefined and two columns for two functions", () => {
    let st = keys(initial(), "yeq", "sqrt", "x", "rparen", "down", "x", "square", "table");
    st = keys(st, "up", "up");
    const lines = screenText(st).lines.map((l) => l.trimEnd());
    expect(lines[0]).toMatch(/X\s+Y1\s+Y2/);
    expect(lines[1]).toMatch(/-2\s+ERROR\s+4/);
  });
  it("refuses a zero step", () => {
    const st = keys(initial(), "setup", "enter", "0", "table");
    expect(st.screen).toBe("tblset");
    expect(st.message).toBe("ERR:INVALID");
  });
  it("computes x without float noise", () => {
    expect(tableX({ start: 0, step: 0.1 }, 3)).toBe(0.3);
  });
});

describe("display text", () => {
  it("is always 8 rows of 16 columns", () => {
    for (const k of ["home", "yeq", "window", "zoom", "table", "setup"]) {
      const st = k === "home" ? type(initial(), "12345678901234567890") : press(initial(), k);
      const t = screenText(st);
      expect(t.lines).toHaveLength(ROWS);
      for (const l of t.lines) expect(l).toHaveLength(COLS);
    }
  });
  it("wraps long input and places the cursor", () => {
    const st = type(initial(), "1".repeat(20));
    const t = screenText(st);
    expect(t.lines.slice(0, 2).map((l) => l.trimEnd())).toEqual(["1".repeat(16), "1111"]);
    expect(t.cursor).toEqual({ row: 1, col: 4 });
  });
  it("scrolls history so the entry stays on the last rows", () => {
    let st = initial();
    for (let i = 1; i <= 6; i++) st = keys(st, String(i), "enter");
    st = press(st, "7");
    const t = screenText(st);
    expect(t.lines[ROWS - 1].trim()).toBe("7");
    expect(t.cursor).toEqual({ row: ROWS - 1, col: 1 });
    expect(t.lines[ROWS - 2].trim()).toBe("6");
  });
  it("right-aligns results", () => {
    const t = screenText(keys(initial(), "1", "add", "1", "enter"));
    expect(t.lines[0].trimEnd()).toBe("1+1");
    expect(t.lines[1]).toBe(" ".repeat(15) + "2");
  });
  it("marks the zoom selection", () => {
    const t = screenText(keys(initial(), "zoom", "down"));
    expect(t.lines[2].startsWith(">2:Zoom in")).toBe(true);
  });
});

describe("fit", () => {
  it("keeps the most digits that fit", () => {
    expect(fit(0.841470985, 5)).toBe("0.841");
    expect(fit(-0.7568, 5)).toBe("-0.76");
    expect(fit(123456, 4)).toBe("1E5");
    expect(fit(7, 4)).toBe("7");
  });
});

describe("saved state", () => {
  it("round-trips the parts worth keeping", () => {
    let st = keys(initial(), "mode", "1", "add", "1", "enter", "yeq", "x", "square", "window", "neg", "5", "enter");
    st = keys(st, "setup", "2", "enter", "3", "graph");
    const back = restore(serialize(st));
    expect(back.angle).toBe("deg");
    expect(back.yeq.fns[0]).toBe("X^2");
    expect(back.win.xmin).toBe(-5);
    expect(back.table).toMatchObject({ start: 2, step: 3 });
    expect(back.home.history[0].output).toBe("2");
    expect(back.screen).toBe("home");
  });
  it("falls back to defaults on junk", () => {
    expect(restore("{nope")).toEqual(initial());
    expect(restore(null)).toEqual(initial());
    expect(restore(JSON.stringify({ fns: ["a"], win: { xmin: "x" }, table: { start: 1, step: 0 } }))).toEqual(initial());
  });
});
