import { languageName } from "../i18n/language";
import { sheetLabels } from "./labels";
import type { SheetOptions, Task, TaskType } from "./types";

const DE_OPERATORS = {
  1: "nenne, gib an, beschreibe, stelle dar, fasse zusammen",
  2: "erkläre, erläutere, vergleiche, ordne ein, wende an, berechne",
  3: "beurteile, bewerte, begründe, nimm Stellung, entwickle",
};
const EN_OPERATORS = {
  1: "name, list, state, define, describe",
  2: "explain, compare, apply, calculate, classify",
  3: "evaluate, justify, assess, argue",
};

const SHAPE: Record<TaskType, string> = {
  choice: '{"type":"choice","instruction":"…","points":4,"level":1,"parts":[{"kind":"mc","prompt":"…","options":["…","…","…","…"],"answer":0},{"kind":"multi","prompt":"…","options":["…","…","…","…"],"answers":[0,2]}]}',
  truefalse: '{"type":"truefalse","instruction":"…","points":3,"level":1,"correctFalse":false,"parts":[{"statement":"…","answer":true},{"statement":"…","answer":false,"correction":"the corrected statement"}]}',
  cloze: '{"type":"cloze","instruction":"…","points":4,"bank":["word1","word2","word3","extra word"],"parts":[{"text":"A text with {1} and {2}.","blanks":[{"accepted":["word1"]},{"accepted":["word2"]}]}]}',
  match: '{"type":"match","instruction":"…","points":4,"parts":[{"items":["…","…","…","…"],"categories":["…","…"],"correctCategory":[0,1,1,0]}]}',
  order: '{"type":"order","instruction":"…","points":3,"parts":[{"prompt":"Put the steps in order.","items":["…","…","…"],"correctOrder":[2,0,1]}]}',
  table: '{"type":"table","instruction":"…","points":4,"parts":[{"columns":["…","…"],"rows":[["A","1"],["B",""],["",  "3"]],"blanks":[{"accepted":["2"]},{"accepted":["C"]}]}]}',
  calc: '{"type":"calc","instruction":"…","points":6,"workLines":4,"parts":[{"prompt":"…","accepted":["12"],"numeric":true,"explanation":"worked solution in one or two lines"}]}',
  open: '{"type":"open","instruction":"…","points":6,"level":2,"parts":[{"prompt":"…","operator":"Explain","level":2,"lines":4,"key":"model answer","rubric":["criterion worth 1 point","criterion worth 1 point"]}]}',
  reading: '{"type":"reading","instruction":"…","points":6,"passage":"A text of 80-150 words.","parts":[{"kind":"mc","prompt":"…","options":["…","…","…"],"answer":1},{"prompt":"…","key":"model answer","rubric":["…"],"lines":3}]}',
};

const RULES: Record<TaskType, (o: SheetOptions) => string> = {
  choice: (o) =>
    `choice: 2-4 questions per task. Each has exactly ${o.optionCount} options. ${
      o.multiCorrect
        ? 'Mix "mc" (one correct) and "multi" (two or more correct, never all; give the indexes in "answers"). A "multi" question says that several answers are right.'
        : '"mc" only, one correct option each.'
    } Wrong options are plausible mistakes, never "all of the above".`,
  truefalse: (o) => `truefalse: 4-6 statements per task, about half false. Every false statement has a "correction" (the true version).${o.language.startsWith("de") ? ' Set "correctFalse" to true when the learner must correct the false statements.' : ""}`,
  cloze: (o) =>
    o.wordBank
      ? 'cloze: one text of 3-6 sentences with 4-7 gaps marked {1}, {2}…. "bank" lists the right words plus 2 extra words that fit no gap; every gap\'s "accepted" is exactly one bank word and no word is used twice.'
      : 'cloze: one text of 3-6 sentences with 4-7 gaps marked {1}, {2}…. No "bank". "accepted" lists every spelling you would mark right (usually one word).',
  match: () => "match: 4-6 items to sort into 2-4 categories (or terms to definitions as categories). correctCategory has the category index per item. Each category gets at least one item.",
  order: () => "order: 3-6 steps or events. correctOrder[i] is the index (into items) of the item that comes i-th. List the items shuffled, not in the right order.",
  table: () => 'table: a table of 2-4 columns and 3-5 rows with 3-6 empty cells ("") the learner must fill. blanks lists the answers in reading order (row by row), one per empty cell.',
  calc: () => 'calc: 2-3 calculation problems per task as separate parts. One final answer each, in "accepted" (number without units; add alternatives like fractions). "explanation" is the worked solution.',
  open: (o) =>
    `open: questions answered in sentences. Each part has a model answer ("key") and a "rubric" of 2-4 criteria that each earn one point. Start the prompt with an operator and set operator, level (Anforderungsbereich 1-3) and lines (answer lines, 2-8). ${
      o.language.startsWith("de") ? `Operatoren: Bereich I: ${DE_OPERATORS[1]}; Bereich II: ${DE_OPERATORS[2]}; Bereich III: ${DE_OPERATORS[3]}.` : `Operators: level 1: ${EN_OPERATORS[1]}; level 2: ${EN_OPERATORS[2]}; level 3: ${EN_OPERATORS[3]}.`
    }`,
  reading: () => "reading: a short passage of 80-150 words (taken from or condensed from the material) and 3-5 questions about it, each answerable from the passage: mc parts, or open parts with key and rubric.",
};

const DIFFICULTY = { easy: "easy: recall and recognise, one step", medium: "medium: apply what the material says to new cases", hard: "hard: several steps, compare, justify" };

const PRESET_NOTE: Record<string, string> = {
  international: "A general school worksheet.",
  arbeitsblatt: "A German Arbeitsblatt: friendly, short tasks, clear instructions, mostly closed tasks that can be done in one lesson.",
  klassenarbeit: "A German Klassenarbeit (class test) with points per task. Cover Anforderungsbereich I (about 50%), II (about 35%) and III (about 15%) by points.",
  ihk: "An IHK-style exam: gebundene Aufgaben (closed: choice, true/false, matching, cloze) and ungebundene Aufgaben (open, calculations, tables), 100 points in total, practical and workplace-related wording.",
  ged: "A GED-style practice sheet: situations from daily life and work, passages and data to read, plain wording.",
  us: "A US school worksheet for a classroom quiz, graded with letter grades.",
};

export const worksheetPromptStart = "Write a worksheet for a learner";

/** First line is stable: the mock backend and the eval harness match it. */
export function worksheetPrompt(o: SheetOptions, material: string, avoid: string[] = []): string {
  const l = sheetLabels(o.language);
  const size = o.mode === "points" ? `${o.totalPoints} points in total (the task points must add up to ${o.totalPoints})` : `exactly ${o.taskCount} tasks (points: 1 to 2 per question, task points = the sum)`;
  return [
    `${worksheetPromptStart} from their own study material.`,
    PRESET_NOTE[o.preset] ?? "",
    `MATERIAL\n"""\n${material}\n"""`,
    o.topic.trim() ? `Focus on: ${o.topic.trim()}.` : "Cover the material's most important ideas.",
    `Size: ${size}. Difficulty ${DIFFICULTY[o.difficulty]}.`,
    `Task types to use (only these, in this order of preference): ${o.taskTypes.join(", ")}. Each task has "type", "instruction" (one imperative sentence in the sheet's language; e.g. "${l.instructions[o.taskTypes[0]]}"), "points" and "parts".`,
    o.taskTypes.map((t) => `- ${RULES[t](o)}\n  Shape: ${SHAPE[t]}`).join("\n"),
    avoid.length ? `Variant B: write different questions from these, on the same ideas:\n${avoid.slice(0, 30).map((a) => `- ${a.slice(0, 90)}`).join("\n")}` : "",
    "Order the tasks from easy to hard. Use only facts from the material. Every answer must be unambiguous and stated or directly derivable from it. Math in LaTeX inside $…$.",
    `The sheet's language is ${languageName(o.language)}: ${o.language.startsWith("de") ? "write everything in German, including instructions and the title" : `write everything in ${languageName(o.language)}, including instructions and the title`}. Keep technical terms as the material spells them.`,
    'Return JSON only: {"title":"…","instructions":"one sentence for the top of the sheet","tasks":[…]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const regeneratePromptStart = "Rewrite ONE task of a worksheet";

export function regenerateTaskPrompt(o: SheetOptions, material: string, task: Task, avoid: string[]): string {
  return [
    `${regeneratePromptStart} with a new set of questions.`,
    `MATERIAL\n"""\n${material}\n"""`,
    `The task type is ${task.type} and it is worth ${task.points} points. Instruction: ${task.instruction}`,
    `Rules: ${RULES[task.type](o)}\nShape: ${SHAPE[task.type]}`,
    avoid.length ? `Don't repeat these questions:\n${avoid.slice(0, 12).map((a) => `- ${a.slice(0, 100)}`).join("\n")}` : "",
    `Difficulty ${DIFFICULTY[o.difficulty]}. Write in ${languageName(o.language)}. Use only facts from the material.`,
    "Return JSON only: the one task object.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const openGradePromptStart = "You grade open answers on a worksheet";

export function openGradePrompt(language: string, items: { id: string; prompt: string; key: string; rubric: string[]; max: number; answer: string }[]): string {
  return [
    `${openGradePromptStart} against a model answer and a rubric.`,
    items.map((x) => `ID ${x.id} (max ${x.max} points)\nQuestion: ${x.prompt}\nModel answer: ${x.key}\nRubric:\n${x.rubric.map((r) => `- ${r}`).join("\n")}\nLearner's answer: """${x.answer || "(blank)"}"""`).join("\n\n"),
    "Give points in steps of 0.5 from 0 to max. Award a rubric point when the answer says it in any wording; a blank answer is 0. Don't reward length or confident tone. The reason is one sentence addressed to the learner that names what was missing or wrong.",
    `Write the reasons in ${languageName(language)}.`,
    'Return JSON only: [{"id":"…","points":1.5,"reason":"…"}]',
  ].join("\n\n");
}

export const paperReadPromptStart = "This is a photo of a filled-in worksheet";

export function paperReadPrompt(tasks: Task[]): string {
  const list = tasks.map((t, ti) => `${ti + 1}: ${t.type}, ${t.parts.length} part${t.parts.length === 1 ? "" : "s"}`).join("\n");
  return [
    `${paperReadPromptStart}. Read what the learner wrote or marked.`,
    `TASKS\n${list}`,
    "For each answer write one line \"task.part: answer\" (parts count from 1). Choice answers: the letters or numbers that are ticked (e.g. \"1.1: b\" or \"1.2: a, c\"). True/false: \"true\" or \"false\". Cloze and table gaps: the words in order of the gaps, separated by \" | \". Matching: the category letter per item, separated by \" | \". Order: the number written next to each item, in the printed item order, separated by \" | \". Open answers and calculations: the written text, final result last. Copy exactly; never correct or complete anything. Skip what is left blank.",
    'Return JSON only: {"problem":"","steps":["1.1: b","2.1: true | false"]}',
  ].join("\n\n");
}
