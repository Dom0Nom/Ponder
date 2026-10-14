import type { CalcCheck } from "./verify";

/** Problems the numeric checker can't decide well: derivatives, matrices, symbolic simplification. */
export const needsSymbolic = (problem: string | undefined, steps: string[]) =>
  /\bd\/d[a-z]\b|\bderivative\b|\bdifferentiate\b|\bsimplify\b|\bexpand\b|\bfactor\b|\[\[/i.test([problem ?? "", ...steps].join("\n"));

const PY = `
import json, re
from sympy import Matrix, simplify, diff, sympify, zeros
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application, convert_xor
_T = standard_transformations + (implicit_multiplication_application, convert_xor)

def _p(text):
    t = text.strip().replace("\\u00b7", "*").replace("\\u00d7", "*").replace("\\u2212", "-")
    t = re.sub(r"\\[\\[.*?\\]\\]", lambda m: "Matrix(" + m.group(0) + ")", t)
    return parse_expr(t, transformations=_T, local_dict={"Matrix": Matrix})

def _same(a, b):
    d = a - b
    if hasattr(d, "is_zero_matrix") or isinstance(d, Matrix):
        return all(simplify(x) == 0 for x in d)
    return simplify(d) == 0

def _anchor(problem):
    m = re.match(r"^\\s*(?:find |compute |calculate |differentiate )?(?:the )?(?:d/d([a-z])|derivative of)\\s*(?:of )?(.+)$", problem or "", re.I)
    if m and m.group(1):
        return diff(_p(m.group(2)), sympify(m.group(1)))
    m = re.match(r"^\\s*(?:differentiate|derivative of)\\s+(.+?)(?:\\s+with respect to\\s+([a-z]))?\\s*$", problem or "", re.I)
    if m:
        e = _p(m.group(1))
        v = sympify(m.group(2)) if m.group(2) else sorted(e.free_symbols, key=str)[0]
        return diff(e, v)
    m = re.match(r"^\\s*(?:simplify|expand|factor)\\s+(.+)$", problem or "", re.I)
    return _p(m.group(1)) if m else None

def _run(problem, steps):
    out = []
    try:
        anchor = _anchor(problem)
    except Exception:
        anchor = None
    for s in steps:
        if "=" in re.sub(r"[<>!=]=", "", s):
            out.append(None); anchor = None; continue
        try:
            cur = _p(s)
        except Exception:
            out.append(None); anchor = None; continue
        if anchor is None:
            out.append(None)
        else:
            try:
                out.append(bool(_same(anchor, cur)))
            except Exception:
                out.append(None)
        anchor = cur
    return out
`;

export function sympyProgram(problem: string | undefined, steps: string[]): string {
  return `${PY}\nprint(json.dumps(_run(${JSON.stringify(problem ?? "")}, ${JSON.stringify(steps)})))`;
}

export function parseSympyOutput(output: string, count: number): (boolean | null)[] | null {
  try {
    const v = JSON.parse(output.trim().split("\n").at(-1) ?? "");
    return Array.isArray(v) && v.length === count ? v.map((x) => (x === true ? true : x === false ? false : null)) : null;
  } catch {
    return null;
  }
}

/** Fills the steps the numeric check left undecided with SymPy's answer; steps it can't parse stay undecided. */
export function mergeSympy(calc: CalcCheck[], sym: (boolean | null)[] | null): CalcCheck[] {
  if (!sym) return calc;
  return calc.map((c, i) => {
    if (c.status !== "undecided" || sym[i] === null) return c;
    return sym[i] ? { status: "right", kind: "value" } : { status: "wrong", kind: "solutions", solution: null, var: null, solvesBefore: false };
  });
}

export async function sympyVerify(problem: string | undefined, steps: string[], calc: CalcCheck[]): Promise<CalcCheck[]> {
  if (!calc.some((c) => c.status === "undecided") || !needsSymbolic(problem, steps)) return calc;
  try {
    const { runCell } = await import("../codecell/run");
    const r = await runCell("python", `import sympy\n${sympyProgram(problem, steps)}`);
    return r.ok ? mergeSympy(calc, parseSympyOutput(r.output, steps.length)) : calc;
  } catch {
    return calc;
  }
}
