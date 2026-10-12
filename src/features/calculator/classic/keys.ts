export type KeyKind = "fn" | "menu" | "num" | "op" | "second" | "enter";

export interface ClassicKey {
  id: string;
  kind: KeyKind;
}

const k = (kind: KeyKind, ...ids: string[]): ClassicKey[] => ids.map((id) => ({ id, kind }));

/** Five keys per row, top to bottom. */
export const CLASSIC_ROWS: ClassicKey[][] = [
  k("menu", "yeq", "window", "zoom", "trace", "graph"),
  [{ id: "2nd", kind: "second" }, ...k("menu", "mode", "table", "setup"), { id: "del", kind: "fn" }],
  k("fn", "left", "up", "down", "right", "clear"),
  k("fn", "x", "sin", "cos", "tan", "pow"),
  k("fn", "square", "sqrt", "log", "ln", "lparen"),
  [...k("num", "7", "8", "9"), { id: "div", kind: "op" }, { id: "rparen", kind: "fn" }],
  [...k("num", "4", "5", "6"), { id: "mul", kind: "op" }, { id: "pi", kind: "fn" }],
  [...k("num", "1", "2", "3"), { id: "sub", kind: "op" }, { id: "ans", kind: "fn" }],
  [...k("num", "0", ".", "neg"), { id: "add", kind: "op" }, { id: "enter", kind: "enter" }],
];

export const CLASSIC_KEYBOARD: Record<string, string> = {
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
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "^": "pow",
  "(": "lparen",
  ")": "rparen",
  x: "x",
  X: "x",
  Enter: "enter",
  Backspace: "del",
  Delete: "del",
  Escape: "clear",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  F1: "yeq",
  F2: "window",
  F3: "zoom",
  F4: "trace",
  F5: "graph",
};
