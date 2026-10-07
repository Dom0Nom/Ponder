import { describe, expect, test } from "vitest";
import data from "../../../../docs/redesign/calculator/vectors.json";
import { Calculator } from "./index";
import { KNOWN_DIVERGENCES } from "./divergences";

interface Vector {
  id: string;
  mode: string;
  keys: string[];
  expect: { lines: string[]; indicators: string[] };
}

const modes = data.modes as Record<string, string[]>;

export function runVector(v: Pick<Vector, "mode" | "keys">) {
  const c = new Calculator();
  c.pressAll(data.start.reset);
  for (const m of v.mode.split("+")) c.pressAll(modes[m]);
  c.pressAll(v.keys);
  return c.text();
}

describe.each(data.vectors as Vector[])("vector $id", (v) => {
  const reason = KNOWN_DIVERGENCES[v.id];
  const t = reason ? test.fails : test;
  t(reason ? `${v.mode} (differs on purpose: ${reason})` : v.mode, () => {
    expect(runVector(v)).toEqual({ lines: v.expect.lines, indicators: v.expect.indicators });
  });
});
