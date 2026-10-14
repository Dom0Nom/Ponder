import type { FormulaSheetId } from "./formats";

export interface FormulaItem {
  id: string;
  tex: string;
}
export interface FormulaGroup {
  id: string;
  items: FormulaItem[];
}

const MATH: FormulaGroup[] = [
  {
    id: "area",
    items: [
      { id: "square", tex: "A = s^2" },
      { id: "rectangle", tex: "A = lw" },
      { id: "parallelogram", tex: "A = bh" },
      { id: "triangle", tex: "A = \\tfrac{1}{2}bh" },
      { id: "trapezoid", tex: "A = \\tfrac{1}{2}h(b_1 + b_2)" },
      { id: "circle", tex: "A = \\pi r^2" },
    ],
  },
  {
    id: "perimeter",
    items: [
      { id: "square", tex: "P = 4s" },
      { id: "rectangle", tex: "P = 2l + 2w" },
      { id: "triangle", tex: "P = s_1 + s_2 + s_3" },
      { id: "circumference", tex: "C = 2\\pi r = \\pi d" },
    ],
  },
  {
    id: "volume",
    items: [
      { id: "cube", tex: "V = s^3" },
      { id: "prism", tex: "V = lwh" },
      { id: "pyramid", tex: "V = \\tfrac{1}{3}Bh" },
      { id: "cylinder", tex: "V = \\pi r^2 h" },
      { id: "cone", tex: "V = \\tfrac{1}{3}\\pi r^2 h" },
      { id: "sphere", tex: "V = \\tfrac{4}{3}\\pi r^3" },
    ],
  },
  {
    id: "surface",
    items: [
      { id: "cube", tex: "SA = 6s^2" },
      { id: "prism", tex: "SA = 2lw + 2lh + 2wh" },
      { id: "cylinder", tex: "SA = 2\\pi r h + 2\\pi r^2" },
      { id: "sphere", tex: "SA = 4\\pi r^2" },
    ],
  },
  {
    id: "algebra",
    items: [
      { id: "slope", tex: "m = \\dfrac{y_2 - y_1}{x_2 - x_1}" },
      { id: "slopeIntercept", tex: "y = mx + b" },
      { id: "pointSlope", tex: "y - y_1 = m(x - x_1)" },
      { id: "quadratic", tex: "x = \\dfrac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
      { id: "pythagorean", tex: "a^2 + b^2 = c^2" },
      { id: "interest", tex: "I = prt" },
      { id: "distance", tex: "d = rt" },
      { id: "cost", tex: "\\text{total cost} = (\\text{number of units})(\\text{price per unit})" },
    ],
  },
];

const SCIENCE: FormulaGroup[] = [
  {
    id: "data",
    items: [
      { id: "mean", tex: "\\text{mean} = \\dfrac{\\text{sum of the values}}{\\text{number of values}}" },
      { id: "median", tex: "\\text{median} = \\text{middle value of the ordered data}" },
      { id: "mode", tex: "\\text{mode} = \\text{most frequent value}" },
      { id: "range", tex: "\\text{range} = \\text{highest value} - \\text{lowest value}" },
    ],
  },
];

export const FORMULA_SHEETS: Record<FormulaSheetId, FormulaGroup[]> = { math: MATH, science: SCIENCE };

/** The reference sheet for a practice topic, if its subject has one (GED math topics). */
export const practiceSheetFor = (topicKey: string): FormulaSheetId | null => (/^ged\.math\./.test(topicKey) ? "math" : null);
