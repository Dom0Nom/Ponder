import type { QuestionKind } from "./types";

const KIND_RULES: Record<QuestionKind, string> = {
  mc: '"mc": one correct option. {"kind":"mc","prompt":"…","options":["…","…","…","…"],"answer":0,"explanation":"…"}',
  multi: '"multi": select all that apply, 2 or more correct but never all. {"kind":"multi","prompt":"…","options":["…","…","…","…"],"answers":[0,2],"explanation":"…"}',
  fill: '"fill": a number or one short term. accepted lists every spelling you would mark right. {"kind":"fill","prompt":"…","accepted":["12"],"numeric":true,"explanation":"…"}',
  dropdown: '"dropdown": a sentence or short passage with {1}, {2}… marking blanks, each with its own options. {"kind":"dropdown","prompt":"Choose the best word for each blank.","text":"The result is {1} because {2}.","blanks":[{"options":["…","…","…"],"answer":0},{"options":["…","…","…"],"answer":1}],"explanation":"…"}',
  drag: '"drag": put items in order ({"mode":"order","items":[…],"correctOrder":[index of the item that goes first, then second, …]}) or sort items into categories ({"mode":"categorize","items":[…],"categories":[…],"correctCategory":[category index per item]}).',
  hotspot: '"hotspot": the learner clicks one place on a stimulus that is a plane, chart or table. region is {"shape":"circle","x":2,"y":3,"r":0.5} in plane or chart data units, or {"shape":"cell","row":1,"col":2} (0-based, body rows) for a table. {"kind":"hotspot","prompt":"Click the point where …","stimulus":{…},"region":{…}}',
};

export const STIMULUS_RULES = [
  'Optional "stimulus" on any question, only when the question truly needs it (data to read, a passage to analyse); never a picture, map or photo:',
  '- {"type":"passage","title":"…","text":"…"} (under 120 words)',
  '- {"type":"table","title":"…","columns":["…"],"rows":[["…"]]}',
  '- {"type":"chart","chart":{"type":"bar"|"line","title":"…","xLabel":"…","yLabel":"…","categories":["…"],"series":[{"name":"…","values":[1,2]}]}} or scatter: {"type":"chart","chart":{"type":"scatter","series":[{"name":"…","points":[[1,2],[2,3]]}]}}. Use real numbers that make the question answerable by reading the chart.',
  '- {"type":"plane","xMin":-5,"xMax":5,"yMin":-5,"yMax":5,"points":[{"x":1,"y":2,"label":"A"}],"lines":[{"m":2,"b":1}]}',
].join("\n");

/** Shared by exam, practice and quiz generation: what each kind looks like and how to key it. */
export function questionKindsPrompt(kinds: readonly QuestionKind[], opts: { stimulus?: boolean } = {}): string {
  return [
    `Each question is a JSON object with "kind" and "prompt". Kinds you may use:`,
    ...kinds.map((k) => `- ${KIND_RULES[k]}`),
    opts.stimulus ? STIMULUS_RULES : "",
    'All answers must be unambiguous and checkable. "points" is optional (default 1). "explanation" is one sentence.',
  ]
    .filter(Boolean)
    .join("\n");
}

export const GED_KINDS: readonly QuestionKind[] = ["mc", "multi", "fill", "dropdown", "drag", "hotspot"];
