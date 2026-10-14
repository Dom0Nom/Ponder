import type { LabelStyle, TaskType } from "./types";

/** Text printed on the sheet itself, in the sheet's language (not the app's). German and English; other languages print English. */
export interface SheetLabels {
  name: string;
  className: string;
  date: string;
  task: string;
  points: string;
  total: string;
  grade: string;
  key: string;
  keyTitle: string;
  gradeScale: string;
  from: string;
  correct: string;
  workSpace: string;
  statement: string;
  trueLabel: string;
  falseLabel: string;
  wordBank: string;
  levels: Record<1 | 2 | 3, string>;
  types: Record<TaskType, string>;
  instructions: Record<TaskType, string>;
  correctFalse: string;
  scaleHeader: string;
}

const en: SheetLabels = {
  name: "Name",
  className: "Class",
  date: "Date",
  task: "Task",
  points: "Points",
  total: "Total",
  grade: "Grade",
  key: "Answer key",
  keyTitle: "Answer key",
  gradeScale: "Grading scale",
  from: "of",
  correct: "Correct it",
  workSpace: "Working",
  statement: "Statement",
  trueLabel: "True",
  falseLabel: "False",
  wordBank: "Word bank",
  levels: { 1: "Level I: reproduce", 2: "Level II: apply", 3: "Level III: evaluate" },
  types: {
    choice: "Multiple choice",
    truefalse: "True or false",
    cloze: "Fill in the blanks",
    match: "Matching",
    order: "Put in order",
    table: "Complete the table",
    calc: "Calculations",
    open: "Short answers",
    reading: "Reading comprehension",
  },
  instructions: {
    choice: "Choose the correct answer.",
    truefalse: "Mark each statement as true or false.",
    cloze: "Fill in the blanks.",
    match: "Match each item to its group.",
    order: "Put the items in the correct order.",
    table: "Complete the table.",
    calc: "Solve. Show your working.",
    open: "Answer in full sentences.",
    reading: "Read the text and answer the questions.",
  },
  correctFalse: "Correct the false statements.",
  scaleHeader: "Points needed",
};

const de: SheetLabels = {
  name: "Name",
  className: "Klasse",
  date: "Datum",
  task: "Aufgabe",
  points: "Punkte",
  total: "Gesamt",
  grade: "Note",
  key: "Lösungsblatt",
  keyTitle: "Lösungsblatt",
  gradeScale: "Notenschlüssel",
  from: "von",
  correct: "Korrigiere",
  workSpace: "Rechenweg",
  statement: "Aussage",
  trueLabel: "Richtig",
  falseLabel: "Falsch",
  wordBank: "Wörter im Kasten",
  levels: { 1: "Anforderungsbereich I: Wiedergeben", 2: "Anforderungsbereich II: Anwenden", 3: "Anforderungsbereich III: Beurteilen" },
  types: {
    choice: "Ankreuzen",
    truefalse: "Richtig oder Falsch",
    cloze: "Lückentext",
    match: "Zuordnen",
    order: "Reihenfolge",
    table: "Tabelle ausfüllen",
    calc: "Rechenaufgaben",
    open: "Offene Fragen",
    reading: "Textverständnis",
  },
  instructions: {
    choice: "Kreuze die richtige Antwort an.",
    truefalse: "Kreuze an: Richtig oder Falsch?",
    cloze: "Ergänze die Lücken.",
    match: "Ordne zu.",
    order: "Bringe die Schritte in die richtige Reihenfolge.",
    table: "Fülle die Tabelle aus.",
    calc: "Berechne. Schreibe deinen Rechenweg auf.",
    open: "Beantworte die Fragen in ganzen Sätzen.",
    reading: "Lies den Text und beantworte die Fragen.",
  },
  correctFalse: "Korrigiere die falschen Aussagen.",
  scaleHeader: "Mindestpunkte",
};

const TABLE: Record<string, SheetLabels> = { en, de };

export const sheetLabels = (language: string): SheetLabels => TABLE[language.split("-")[0].toLowerCase()] ?? en;

export const LANGUAGES_WITH_LABELS = ["en", "de"] as const;

export function optionLabel(style: LabelStyle, i: number): string {
  if (style === "abc") return `${String.fromCharCode(97 + i)})`;
  if (style === "ABC") return `${String.fromCharCode(65 + i)}.`;
  if (style === "123") return `${i + 1}.`;
  return "☐";
}

/** Letter paper in the US, Canada and the Philippines; A4 elsewhere. */
export function paperFor(language: string, region?: string): "a4" | "letter" {
  const r = (region ?? (language.includes("-") ? language.split("-")[1] : "")).toUpperCase();
  return ["US", "CA", "PH", "MX"].includes(r) ? "letter" : "a4";
}
