/** Key table measured from UI-SPEC §4 (device frame 400×560, CSS px). Legends use a small markup:
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

const COLS = [76, 126, 176, 226, 276];
const ROWS: Record<string, [number, number]> = {
  A: [184, 38],
  B: [224, 38],
  "1": [264, 37],
  "2": [304, 37],
  "3": [344, 37],
  "4": [383, 38],
  "5": [423, 37],
  "6": [463, 37],
  "7": [503, 37],
};

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
    w: col === 4 && (row === "6" || row === "7") ? 47 : 48,
    h,
  }));
});

/** Arrow pad (UI-SPEC §5): ellipse box and the outer-edge arrow positions. */
export const ARROW_PAD = { x: 227, y: 185, w: 97, h: 77, hole: { x: 266, y: 217, w: 18, h: 12 } };

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
