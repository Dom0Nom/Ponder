/** Key table (device frame 400×560, CSS px). Legends use a small markup:
 * `{…}` after text is a superscript; `{nd}`, `{Und}`, `{pi}`, `{var}`, `{toggle}`, `{caret}` are drawn specially. */

export type KeyKind = "second" | "fn" | "op" | "num";

export interface KeyDef {
  id: string;
  main: string;
  second?: string;
  kind: KeyKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLS = [75.95, 126.2, 176.45, 226.7, 276.95];
const ROWS: Record<string, [number, number]> = {
  A: [184.28, 36.75],
  B: [224.03, 36.75],
  "1": [264.03, 36.5],
  "2": [303.78, 36.5],
  "3": [343.53, 36.5],
  "4": [383.28, 36.5],
  "5": [423.03, 36.5],
  "6": [462.78, 36.5],
  "7": [502.53, 36.5],
};
/** Key pitch; each key's hit target is the full cell centred on it. */
export const PITCH = { x: 50.25, y: 39.77 };

type Spec = [id: string, main: string, second: string | undefined, kind: KeyKind];

const GRID: Record<string, Spec[]> = {
  A: [
    ["2nd", "2nd", undefined, "second"],
    ["mode", "mode", "quit", "fn"],
    ["delete", "delete", "insert", "fn"],
  ],
  B: [
    ["log", "log", "10{x}", "fn"],
    ["prb", "prb", "angle", "fn"],
    ["data", "data", "stat", "fn"],
  ],
  "1": [
    ["ln", "ln", "e{x}", "fn"],
    ["frac", "{nd}", "{Und}", "fn"],
    ["x10n", "×10{n}", "{nd}◂▸{Und}", "fn"],
    ["table", "table", "f◂▸d", "fn"],
    ["clear", "clear", undefined, "fn"],
  ],
  "2": [
    ["pi", "{pi}", "hyp", "fn"],
    ["sin", "sin", "sin{-1}", "fn"],
    ["cos", "cos", "cos{-1}", "fn"],
    ["tan", "tan", "tan{-1}", "fn"],
    ["div", "÷", "K", "op"],
  ],
  "3": [
    ["pow", "{caret}", "{x}√", "fn"],
    ["recip", "x{-1}", undefined, "fn"],
    ["lparen", "(", "%", "fn"],
    ["rparen", ")", "▸%", "fn"],
    ["mul", "×", undefined, "op"],
  ],
  "4": [
    ["square", "x{2}", "√", "fn"],
    ["7", "7", undefined, "num"],
    ["8", "8", undefined, "num"],
    ["9", "9", undefined, "num"],
    ["sub", "−", undefined, "op"],
  ],
  "5": [
    ["var", "{var}", "clear var", "fn"],
    ["4", "4", undefined, "num"],
    ["5", "5", undefined, "num"],
    ["6", "6", undefined, "num"],
    ["add", "+", undefined, "op"],
  ],
  "6": [
    ["sto", "sto→", "recall", "fn"],
    ["1", "1", undefined, "num"],
    ["2", "2", undefined, "num"],
    ["3", "3", undefined, "num"],
    ["toggle", "{toggle}", undefined, "num"],
  ],
  "7": [
    ["on", "on", "off", "fn"],
    ["0", "0", "reset", "num"],
    [".", ".", ",", "num"],
    ["neg", "(−)", "ans", "num"],
    ["enter", "enter", undefined, "num"],
  ],
};

export const KEY_DEFS: KeyDef[] = Object.entries(GRID).flatMap(([row, specs]) => {
  const [y, h] = ROWS[row];
  return specs.map(([id, main, second, kind], col) => ({
    id,
    main,
    second,
    kind,
    x: COLS[col],
    y,
    w: 47,
    h,
  }));
});

/** Arrow pad: ellipse box and the outer-edge arrow positions. */
export const ARROW_PAD = { x: 227.2, y: 184.8, w: 96.3, h: 75.5, hole: { w: 18, h: 12 } };

/** Physical keyboard → key name. */
export const KEYBOARD: Record<string, string> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  ".": ".",
  ",": ".",
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "^": "pow",
  "(": "lparen",
  ")": "rparen",
  Enter: "enter",
  "=": "enter",
  Backspace: "delete",
  Delete: "delete",
  Escape: "clear",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
