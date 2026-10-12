import { HOLE } from "../lcd/layout";

export type TplKind = "frac" | "mixed" | "sqrt" | "root" | "pow";
export type El = { k: "t"; v: string } | { k: TplKind; s: El[][] };

export const tok = (v: string): El => ({ k: "t", v });
export const tpl = (k: TplKind, ...s: El[][]): El => ({ k, s });
export const isTok = (e: El | undefined, v?: string): e is { k: "t"; v: string } =>
  !!e && e.k === "t" && (v === undefined || e.v === v);

export const VARS = ["x", "y", "z", "t", "a", "b", "c"];
export const CURSOR = "\uE000";
/** Cursor while insert mode is on (drawn as an underline). */
export const CURSOR_INS = "\uE003";

/** Entry editor: a tree of elements with a cursor (path into templates + position). */
export interface Ed {
  els: El[];
  path: { i: number; s: number }[];
  pos: number;
  ins: boolean;
}

export const newEd = (els: El[] = []): Ed => ({ els, path: [], pos: els.length, ins: false });

export function clone(els: El[]): El[] {
  return els.map((e) => (e.k === "t" ? { ...e } : { k: e.k, s: e.s.map(clone) }));
}

export function listAt(ed: Ed): El[] {
  let l = ed.els;
  for (const p of ed.path) l = (l[p.i] as { s: El[][] }).s[p.s];
  return l;
}

function parentTpl(ed: Ed): { list: El[]; el: { k: TplKind; s: El[][] }; i: number; s: number } | undefined {
  if (!ed.path.length) return undefined;
  let l = ed.els;
  for (const p of ed.path.slice(0, -1)) l = (l[p.i] as { s: El[][] }).s[p.s];
  const top = ed.path[ed.path.length - 1];
  return { list: l, el: l[top.i] as { k: TplKind; s: El[][] }, i: top.i, s: top.s };
}

export const isEmpty = (ed: Ed) => ed.els.length === 0;


/** Insert elements at the cursor. A single element overwrites unless insert mode is on or the cursor is at the end. */
export function insert(ed: Ed, els: El[], enter?: { at: number; slot: number; end?: boolean }) {
  const l = listAt(ed);
  const overwrite = els.length === 1 && !ed.ins && ed.pos < l.length && l[ed.pos].k === "t";
  l.splice(ed.pos, overwrite ? 1 : 0, ...els);
  if (enter) {
    const at = ed.pos + enter.at;
    const target = (l[at] as { s: El[][] }).s[enter.slot];
    ed.path.push({ i: at, s: enter.slot });
    ed.pos = enter.end ? target.length : 0;
  } else {
    ed.pos += els.length;
  }
}

const OPERAND = /^([0-9.]|π|e|ans|[xyztabc])$/;

/** Remove and return the number/constant run just before the cursor (it becomes a numerator, index, or unit). */
export function takeOperand(ed: Ed): El[] {
  const l = listAt(ed);
  let i = ed.pos;
  while (i > 0 && isTok(l[i - 1]) && OPERAND.test((l[i - 1] as { v: string }).v)) i--;
  const taken = l.splice(i, ed.pos - i);
  ed.pos = i;
  return taken;
}

const POSTFIX = /^(%|²|⁻¹|!|°|'|"|ʳ|ᵍ)$/;

/** Start of the whole operand that ends at `pos`: numbers, constants, templates, postfix marks and (…) groups. */
export function operandStart(l: El[], pos: number): number {
  let i = pos;
  while (i > 0) {
    const e = l[i - 1];
    if (e.k !== "t" || OPERAND.test(e.v) || POSTFIX.test(e.v)) {
      i--;
      continue;
    }
    if (e.v !== ")") break;
    let depth = 0;
    let j = i - 1;
    for (; j >= 0; j--) {
      const t = l[j];
      if (t.k !== "t") continue;
      if (t.v === ")") depth++;
      else if (t.v.endsWith("(") && --depth === 0) break;
    }
    if (j < 0) break;
    i = j;
  }
  return i;
}

/** Remove and return the whole operand before the cursor (the x-root index, BEHAVIOR §9). */
export function takeIndex(ed: Ed): El[] {
  const l = listAt(ed);
  let run = ed.pos;
  while (run > 0 && isTok(l[run - 1]) && OPERAND.test((l[run - 1] as { v: string }).v)) run--;
  // after a power, a number typed next is the index on its own
  const i = run < ed.pos && l[run - 1]?.k === "pow" ? run : operandStart(l, ed.pos);
  const taken = l.splice(i, ed.pos - i);
  ed.pos = i;
  return taken;
}

/** `x²`, `x⁻¹` or `^` right after a power wrap the operand in real parentheses: `(8^{2})^{5}`. */
export function wrapPower(ed: Ed) {
  const l = listAt(ed);
  if (l[ed.pos - 1]?.k !== "pow") return;
  const i = operandStart(l, ed.pos);
  l.splice(ed.pos, 0, tok(")"));
  l.splice(i, 0, tok("("));
  ed.pos += 2;
}

export function prevEl(ed: Ed): El | undefined {
  return listAt(ed)[ed.pos - 1];
}

export function right(ed: Ed): boolean {
  const l = listAt(ed);
  if (ed.pos < l.length) {
    const e = l[ed.pos];
    if (e.k !== "t") {
      ed.path.push({ i: ed.pos, s: 0 });
      ed.pos = 0;
    } else ed.pos++;
    return true;
  }
  const p = parentTpl(ed);
  if (!p) return false;
  ed.path.pop();
  if (p.s < p.el.s.length - 1) {
    ed.path.push({ i: p.i, s: p.s + 1 });
    ed.pos = 0;
  } else ed.pos = p.i + 1;
  return true;
}

export function left(ed: Ed): boolean {
  const l = listAt(ed);
  if (ed.pos > 0) {
    const e = l[ed.pos - 1];
    if (e.k !== "t") {
      ed.path.push({ i: ed.pos - 1, s: e.s.length - 1 });
      ed.pos = e.s[e.s.length - 1].length;
    } else ed.pos--;
    return true;
  }
  const p = parentTpl(ed);
  if (!p) return false;
  ed.path.pop();
  if (p.s > 0) {
    ed.path.push({ i: p.i, s: p.s - 1 });
    ed.pos = p.el.s[p.s - 1].length;
  } else ed.pos = p.i;
  return true;
}

export function home(ed: Ed) {
  ed.path = [];
  ed.pos = 0;
}

export function end(ed: Ed) {
  ed.path = [];
  ed.pos = ed.els.length;
}

/** Up/down between numerator and denominator. Returns false when not inside a fraction. */
export function vertical(ed: Ed, dir: 1 | -1): boolean {
  for (let k = ed.path.length - 1; k >= 0; k--) {
    const sub: Ed = { ...ed, path: ed.path.slice(0, k + 1) };
    const p = parentTpl(sub)!;
    if (p.el.k !== "frac" && p.el.k !== "mixed") continue;
    const numSlot = p.el.k === "frac" ? 0 : 1;
    const target = dir === 1 ? (p.s === numSlot ? numSlot + 1 : -1) : p.s === numSlot + 1 ? numSlot : -1;
    if (target < 0) continue;
    ed.path = [...ed.path.slice(0, k), { i: p.i, s: target }];
    const l = p.el.s[target];
    ed.pos = dir === -1 ? l.length : Math.min(ed.pos, l.length);
    return true;
  }
  return false;
}

/** Remove the template holding the cursor; the content of its other slots stays inline. `e^{}` goes with its `e`. */
function unwrap(ed: Ed) {
  const p = parentTpl(ed)!;
  ed.path.pop();
  const before = p.el.s.slice(0, p.s).flat();
  const after = p.el.s.slice(p.s + 1).flat();
  const at = p.el.k === "pow" && isTok(p.list[p.i - 1], "e") ? p.i - 1 : p.i;
  p.list.splice(at, p.i + 1 - at, ...before, ...after);
  ed.pos = at + before.length;
}

/** `delete` (BEHAVIOR §5): emptying a power, √ or x-root slot removes the template; in an empty slot it always does. */
export function del(ed: Ed) {
  const l = listAt(ed);
  const p = parentTpl(ed);
  if (!l.length) {
    if (p) unwrap(ed);
    return;
  }
  if (ed.pos < l.length) l.splice(ed.pos, 1);
  else l.splice(--ed.pos, 1);
  if (p && !l.length && p.el.k !== "frac" && p.el.k !== "mixed") unwrap(ed);
}

/** Depth of template nesting at the cursor. */
export const depth = (ed: Ed) => ed.path.length;

export function tokText(v: string, _mathprint: boolean): string {
  if (!v.startsWith("stat:")) return v;
  const name = v.slice(5);
  return name;
}

/** Display markup of an element list (BEHAVIOR §2). `cursor` marks the cursor position. */
export function markup(els: El[], mathprint = true, cursor?: Ed): string {
  const walk = (list: El[], path: { i: number; s: number }[], here: boolean): string => {
    let out = "";
    const curPos = here && cursor && path.length === cursor.path.length ? cursor.pos : -1;
    list.forEach((e, i) => {
      if (i === curPos) out += cursor!.ins ? CURSOR_INS : CURSOR;
      const sub = (s: number) => {
        const next = cursor && here && cursor.path[path.length];
        const inside = !!next && next.i === i && next.s === s;
        return walk(e.k === "t" ? [] : e.s[s], [...path, { i, s }], inside);
      };
      switch (e.k) {
        case "t":
          out += tokText(e.v, mathprint);
          break;
        case "frac":
          out += `\\f{${sub(0)}}{${sub(1)}}`;
          break;
        case "mixed":
          out += `${sub(0)}${e.s[0].length ? "" : HOLE}\\f{${sub(1)}}{${sub(2)}}`;
          break;
        case "sqrt":
          out += `√{${sub(0)}}`;
          break;
        case "root":
          out += `\\r{${sub(0)}}{${sub(1)}}`;
          break;
        case "pow":
          out += `^{${sub(0)}}`;
          break;
      }
    });
    if (curPos === list.length) out += cursor!.ins ? CURSOR_INS : CURSOR;
    return out;
  };
  return walk(els, [], true);
}

export const stripCursor = (s: string) => s.replaceAll(CURSOR, "").replaceAll(CURSOR_INS, "").replaceAll(HOLE, "");

/** Parse display text of a value (e.g. "⁻\f{3}{4}", "2√{2}", "1.5*10^{⁻7}") back into elements. */
export function fromMarkup(s: string): El[] {
  let i = 0;
  const group = (): El[] => {
    const out: El[] = [];
    while (i < s.length && s[i] !== "}") {
      if (s.startsWith("\\f{", i)) {
        i += 3;
        const a = group();
        i += 2;
        const b = group();
        i++;
        const prev: El[] = [];
        while (out.length && isTok(out[out.length - 1]) && /^[0-9]$/.test((out[out.length - 1] as { v: string }).v))
          prev.unshift(out.pop()!);
        out.push(prev.length ? tpl("mixed", prev, a, b) : tpl("frac", a, b));
      } else if (s.startsWith("√{", i)) {
        i += 2;
        const a = group();
        i++;
        out.push(tpl("sqrt", a));
      } else if (s.startsWith("^{", i)) {
        i += 2;
        const a = group();
        i++;
        out.push(tpl("pow", a));
      } else {
        out.push(tok(s[i]));
        i++;
      }
    }
    return out;
  };
  return group();
}

/** `clear` deletes from the cursor to the end; inside a template it starts at that template (BEHAVIOR §5).
 * Returns false when the whole line goes (cursor at the start, or at the end of the entry). */
export function clearFrom(ed: Ed): boolean {
  const p = parentTpl(ed);
  if (p) {
    const pos = ed.pos;
    ed.path.pop();
    // the whole-number part of a mixed number is on the baseline
    const keep = p.el.k === "mixed" && p.s === 0 ? p.el.s[0].slice(0, pos) : [];
    p.list.splice(p.i, p.list.length - p.i, ...keep);
    ed.pos = p.i + keep.length;
    return true;
  }
  if (ed.pos === 0 || ed.pos >= ed.els.length) return false;
  ed.els.splice(ed.pos);
  return true;
}
