import { describe, expect, it } from "vitest";
import { clampTo, compileCurve, currentValues, parseLab, resetValues, restoreVersion, sampleLab, saveVersion, setValue, substitute } from "./lab";
import { parseOutput } from "./kinds";
import { outputPrompt } from "./prompts";
import { studioReply } from "../../test/studioFixtures";

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Step response",
    xMin: 0,
    xMax: 10,
    params: [
      { id: "k", label: "Gain", min: 0.5, max: 3, step: 0.5, value: 1 },
      { id: "z", label: "Damping", min: 0, max: 1, step: 0.1 },
    ],
    curves: [{ label: "y", expr: "k*(1 - exp(-z*x))" }],
    ...over,
  });

const lab = () => parseLab(reply())!.data;

describe("lab cards", () => {
  it("substitutes parameters and evaluates curves", () => {
    expect(substitute("k*x + sin(x)", { k: 2 })).toBe("(2)*x + sin(x)");
    const f = compileCurve("k*x^2", { k: 3 })!;
    expect(f(2)).toBe(12);
    expect(compileCurve("k*(", { k: 1 })).toBeNull();
  });

  it("validates the reply: reserved ids, bad ranges and unplottable curves are dropped", () => {
    expect(parseLab(reply({ params: [{ id: "x", min: 0, max: 1 }] }))).toBeNull();
    expect(parseLab(reply({ xMax: -1 }))).toBeNull();
    expect(parseLab(reply({ curves: [{ label: "bad", expr: "k*(" }] }))).toBeNull();
    const ok = parseLab(reply({ params: [{ id: "k", min: 1, max: 2, value: 99 }, { id: "k", min: 0, max: 1 }, { id: "sin", min: 0, max: 1 }], curves: [{ label: "y", expr: "k*x" }] }))!;
    expect(ok.data.params).toHaveLength(1);
    expect(ok.data.params[0].value).toBe(2);
  });

  it("clamps and snaps slider values", () => {
    const p = lab().params[0];
    expect(clampTo(p, 99)).toBe(3);
    expect(clampTo(p, 1.26)).toBe(1.5);
    expect(clampTo(p, -4)).toBe(0.5);
  });

  it("keeps slider positions, saves versions newest first and restores them", () => {
    let d = lab();
    expect(currentValues(d)).toEqual({ k: 1, z: 0.5 });
    d = setValue(d, "k", 2.5);
    expect(currentValues(d).k).toBe(2.5);
    d = saveVersion(d, 1);
    d = saveVersion(d, 2);
    expect(d.versions).toHaveLength(1);
    d = saveVersion(setValue(d, "z", 0.9), 3);
    expect(d.versions.map((v) => v.at)).toEqual([3, 1]);
    d = resetValues(d);
    expect(currentValues(d)).toEqual({ k: 1, z: 0.5 });
    expect(currentValues(restoreVersion(d, 1))).toEqual({ k: 2.5, z: 0.5 });
    const round = JSON.parse(JSON.stringify(setValue(d, "k", 3)));
    expect(currentValues(round).k).toBe(3);
  });

  it("samples a plot with a finite y range", () => {
    const d = lab();
    const p = sampleLab(d, currentValues(d));
    expect(p.series[0].points.length).toBe(241);
    expect(p.yMax).toBeGreaterThan(p.yMin);
    expect(p.bad).toEqual([]);
  });

  it("works as a studio output kind with the mock reply", () => {
    const prompt = outputPrompt("lab", { sources: ["A"], passages: [{ source: 1, text: "x" }], summaries: [] });
    expect(prompt.startsWith("Create a lab card for a learner")).toBe(true);
    expect(parseOutput("lab", studioReply(prompt)!)?.data.params).toHaveLength(2);
  });
});
