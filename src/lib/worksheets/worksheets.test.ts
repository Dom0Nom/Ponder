import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { toDocx, toMarkdown } from "./export";
import { openKey, scoreSheet, scoreTask } from "./grade";
import { optionLabel, paperFor, sheetLabels } from "./labels";
import { paperResponses } from "./paper";
import { normalizePoints, parseSheet, parseTask } from "./parse";
import { PRESETS, gradeFor, optionsFor, scaleOf, scaleRows, validThresholds } from "./presets";
import { openGradePrompt, worksheetPrompt, worksheetPromptStart } from "./prompts";
import { emptyAttempt, type Sheet, type Task } from "./types";

const de = optionsFor("klassenarbeit", "de");
const en = optionsFor("international", "en");

const tasksJson = [
  { type: "choice", points: 4, parts: [{ kind: "mc", prompt: "Wo findet die Fotosynthese statt?", options: ["Chloroplast", "Zellkern", "Ribosom"], answer: 0 }, { kind: "multi", prompt: "Was entsteht?", options: ["Sauerstoff", "Glucose", "Stickstoff", "Helium"], answers: [0, 1] }] },
  { type: "truefalse", points: 3, correctFalse: true, parts: [{ statement: "Pflanzen nehmen Sauerstoff auf.", answer: false, correction: "Pflanzen nehmen Kohlenstoffdioxid auf." }, { statement: "Chlorophyll ist grün.", answer: true }] },
  { type: "cloze", points: 4, bank: ["Licht", "Wasser", "Wind"], parts: [{ text: "Die Pflanze nutzt {1} und {2}.", blanks: [{ accepted: ["Licht"] }, { accepted: ["Wasser"] }] }] },
  { type: "match", points: 4, parts: [{ items: ["ATP", "Glucose", "NADPH", "Stärke"], categories: ["Lichtreaktion", "Calvin-Zyklus"], correctCategory: [0, 1, 0, 1] }] },
  { type: "order", points: 3, parts: [{ prompt: "Ordne.", items: ["Licht absorbieren", "Wasser spalten", "Zucker bilden"], correctOrder: [0, 1, 2] }] },
  { type: "table", points: 4, parts: [{ columns: ["Stoff", "Ort"], rows: [["ATP", "Thylakoid"], ["Glucose", ""], ["", "Stroma"]], blanks: [{ accepted: ["Stroma"] }, { accepted: ["RuBisCO"] }] }] },
  { type: "calc", points: 6, workLines: 3, parts: [{ prompt: "Berechne 12 · 3", accepted: ["36"], numeric: true, explanation: "12 · 3 = 36" }] },
  { type: "open", points: 6, parts: [{ prompt: "Erkläre die Lichtreaktion.", operator: "Erkläre", level: 2, lines: 4, key: "Licht spaltet Wasser, ATP entsteht.", rubric: ["Licht spaltet Wasser", "ATP entsteht"] }] },
  { type: "reading", points: 6, passage: "Text.", parts: [{ kind: "mc", prompt: "Was?", options: ["a", "b"], answer: 1 }, { prompt: "Warum?", key: "Darum", rubric: ["Darum"], lines: 2 }] },
];

const sheetOf = (opts = de): Sheet => parseSheet(JSON.stringify({ title: "Fotosynthese", instructions: "Los.", tasks: tasksJson }), { ...opts, mode: "length" });

describe("parse", () => {
  it("accepts every task type", () => {
    const s = sheetOf();
    expect(s.tasks.map((t) => t.type)).toEqual(["choice", "truefalse", "cloze", "match", "order", "table", "calc", "open", "reading"]);
    expect(s.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"]);
    expect(s.tasks[1].parts[0]).toMatchObject({ kind: "mc", options: ["Richtig", "Falsch"], answer: 1 });
    expect(s.tasks[1].correctFalse).toBe(true);
    expect(s.tasks[2].bank).toEqual(["Licht", "Wasser", "Wind"]);
    expect(s.tasks[0].instruction).toBe("Kreuze die richtige Antwort an.");
    expect(s.tasks[6].workLines).toBe(3);
  });

  it("uses English labels for true/false in English sheets", () => {
    const t = parseTask({ type: "truefalse", parts: [{ statement: "x", answer: true }] }, "en", 0);
    expect(t?.parts[0]).toMatchObject({ options: ["True", "False"], answer: 0 });
  });

  it("drops broken parts and tasks", () => {
    expect(parseTask({ type: "cloze", parts: [{ text: "no gaps", blanks: [{ accepted: ["a"] }] }] }, "en", 0)).toBeNull();
    expect(parseTask({ type: "table", parts: [{ columns: ["a", "b"], rows: [["x", ""]], blanks: [] }] }, "en", 0)).toBeNull();
    expect(parseTask({ type: "match", parts: [{ items: ["a", "b"], categories: ["X", "Y"], correctCategory: [0, 5] }] }, "en", 0)).toBeNull();
    expect(parseTask({ type: "open", parts: [{ prompt: "q" }] }, "en", 0)).toBeNull();
    expect(parseTask({ type: "nope", parts: [] }, "en", 0)).toBeNull();
    expect(() => parseSheet("[]", en)).toThrow();
    expect(() => parseSheet("not json", en)).toThrow();
  });

  it("normalises points to the target total", () => {
    const tasks = sheetOf().tasks;
    const n = normalizePoints(tasks, 40);
    expect(n.reduce((a, t) => a + t.points, 0)).toBe(40);
    expect(normalizePoints(tasks, 100).reduce((a, t) => a + t.points, 0)).toBe(100);
    const s = parseSheet(JSON.stringify({ tasks: tasksJson }), { ...de, mode: "points", totalPoints: 100 });
    expect(s.tasks.reduce((a, t) => a + t.points, 0)).toBe(100);
  });
});

describe("grading with partial credit", () => {
  const s = sheetOf();
  const byId = (id: string): Task => s.tasks.find((t) => t.id === id)!;

  it("choice: mc right, multi half right", () => {
    const sc = scoreTask(byId("t1"), [{ kind: "mc", choice: 0 }, { kind: "multi", choices: [0] }]);
    expect(sc.credits).toEqual([1, 0.5]);
    expect(sc.points).toBe(3);
  });

  it("true/false", () => {
    const sc = scoreTask(byId("t2"), [{ kind: "mc", choice: 1 }, { kind: "mc", choice: 1 }]);
    expect(sc.points).toBe(1.5);
  });

  it("cloze and table gaps", () => {
    expect(scoreTask(byId("t3"), [{ kind: "cloze", texts: ["licht", "Luft"] }]).points).toBe(2);
    expect(scoreTask(byId("t6"), [{ kind: "tablefill", texts: ["Stroma", "falsch"] }]).points).toBe(2);
  });

  it("match and order", () => {
    expect(scoreTask(byId("t4"), [{ kind: "drag", placed: [0, 1, 1, 1] }]).points).toBe(3);
    expect(scoreTask(byId("t5"), [{ kind: "drag", order: [0, 2, 1] }]).points).toBeCloseTo(1, 0);
  });

  it("calc accepts formats", () => {
    expect(scoreTask(byId("t7"), [{ kind: "fill", text: "36,0" }]).points).toBe(6);
    expect(scoreTask(byId("t7"), [{ kind: "fill", text: "35" }]).points).toBe(0);
  });

  it("open parts score from the model's points and count as ungraded until then", () => {
    const attempt = { ...emptyAttempt(), responses: { t8: [{ kind: "open" as const, text: "Licht spaltet Wasser" }] } };
    expect(scoreSheet(s, attempt).ungraded).toBe(1);
    const graded = { ...attempt, open: { [openKey("t8", 0)]: { points: 3, max: 6, reason: "ATP fehlt" } } };
    const sc = scoreSheet(s, graded);
    expect(sc.ungraded).toBe(0);
    expect(sc.tasks.find((t) => t.taskId === "t8")!.points).toBe(3);
  });

  it("totals and share", () => {
    const attempt = { ...emptyAttempt(), responses: { t1: [{ kind: "mc" as const, choice: 0 }, { kind: "multi" as const, choices: [0, 1] }], t7: [{ kind: "fill" as const, text: "36" }] } };
    const sc = scoreSheet(s, attempt);
    expect(sc.points).toBe(4 + 6);
    expect(sc.max).toBe(40);
    expect(sc.share).toBeCloseTo(0.25);
  });
});

describe("Notenschlüssel and scales", () => {
  const n = scaleOf("notenschluessel");
  it("maps shares to German grades", () => {
    expect(gradeFor(n, 1)?.label).toBe("1");
    expect(gradeFor(n, 0.92)?.label).toBe("1");
    expect(gradeFor(n, 0.919)?.label).toBe("2");
    expect(gradeFor(n, 0.81)?.label).toBe("2");
    expect(gradeFor(n, 0.67)?.label).toBe("3");
    expect(gradeFor(n, 0.5)?.label).toBe("4");
    expect(gradeFor(n, 0.3)?.label).toBe("5");
    expect(gradeFor(n, 0.29)?.label).toBe("6");
    expect(gradeFor(n, 0)?.value).toBe(6);
  });

  it("respects edited thresholds", () => {
    const custom = { id: "notenschluessel" as const, thresholds: [95, 85, 70, 55, 25] };
    expect(gradeFor(custom, 0.9)?.label).toBe("2");
    expect(gradeFor(custom, 0.26)?.label).toBe("5");
    expect(validThresholds(custom.thresholds)).toBe(true);
    expect(validThresholds([90, 95])).toBe(false);
    expect(validThresholds([120])).toBe(false);
  });

  it("builds the points table for 40 and 100 points", () => {
    expect(scaleRows(n, 40).map((r) => [r.grade, r.min, r.max])).toEqual([["1", 37, 40], ["2", 33, 36], ["3", 27, 32], ["4", 20, 26], ["5", 12, 19], ["6", 0, 11]]);
    expect(scaleRows(n, 100)[0]).toMatchObject({ grade: "1", min: 92, max: 100 });
    expect(scaleRows(scaleOf("none"), 10)).toEqual([]);
  });

  it("US letters and the GED scale", () => {
    const l = scaleOf("letter");
    expect(["A", "B", "C", "D", "F"]).toEqual([0.95, 0.85, 0.75, 0.65, 0.2].map((x) => gradeFor(l, x)!.label));
    expect(gradeFor(scaleOf("ged"), 0)?.label).toBe("100");
    expect(gradeFor(scaleOf("ged"), 1)?.label).toBe("200");
    expect(gradeFor(scaleOf("none"), 0.5)).toBeNull();
  });

  it("presets carry the right defaults", () => {
    expect(PRESETS.klassenarbeit.defaults.scale.id).toBe("notenschluessel");
    expect(PRESETS.ihk.defaults.totalPoints).toBe(100);
    expect(PRESETS.us.defaults.scale.id).toBe("letter");
    expect(PRESETS.ged.defaults.paper).toBe("letter");
    expect(optionsFor("arbeitsblatt", "en").language).toBe("de");
    expect(optionsFor("international", "fr").language).toBe("fr");
  });
});

describe("labels", () => {
  it("names German styles the German way", () => {
    const l = sheetLabels("de-AT");
    expect(l.types.choice).toBe("Ankreuzen");
    expect(l.types.cloze).toBe("Lückentext");
    expect(l.types.match).toBe("Zuordnen");
    expect(l.types.order).toBe("Reihenfolge");
    expect(l.types.table).toBe("Tabelle ausfüllen");
    expect(l.types.calc).toBe("Rechenaufgaben");
    expect(l.types.open).toBe("Offene Fragen");
    expect(l.types.reading).toBe("Textverständnis");
    expect(l.trueLabel).toBe("Richtig");
    expect(l.className).toBe("Klasse");
    expect(sheetLabels("xx").types.choice).toBe("Multiple choice");
  });

  it("option labels and paper size", () => {
    expect([0, 1, 2].map((i) => optionLabel("abc", i))).toEqual(["a)", "b)", "c)"]);
    expect(optionLabel("ABC", 1)).toBe("B.");
    expect(optionLabel("123", 2)).toBe("3.");
    expect(optionLabel("box", 0)).toBe("☐");
    expect(paperFor("en-US")).toBe("letter");
    expect(paperFor("de")).toBe("a4");
    expect(paperFor("en", "CA")).toBe("letter");
  });
});

describe("prompts", () => {
  it("states size, types, language and label rules", () => {
    const p = worksheetPrompt({ ...de, taskTypes: ["choice", "open"], multiCorrect: true, optionCount: 5, mode: "points", totalPoints: 40 }, "[1] Fotosynthese");
    expect(p.startsWith(worksheetPromptStart)).toBe(true);
    expect(p).toContain("40 points in total");
    expect(p).toContain("exactly 5 options");
    expect(p).toContain("multi");
    expect(p).toContain("Anforderungsbereich");
    expect(p).toContain("German");
    expect(p).not.toContain("cloze:");
  });

  it("English sheets get English operators and a word bank rule only when asked", () => {
    const p = worksheetPrompt({ ...en, taskTypes: ["cloze"], wordBank: true }, "m");
    expect(p).toContain('"bank"');
    expect(worksheetPrompt({ ...en, taskTypes: ["cloze"], wordBank: false }, "m")).toContain('No "bank"');
    expect(worksheetPrompt({ ...en, taskTypes: ["open"] }, "m")).toContain("level 1: name, list");
  });

  it("variant B lists what to avoid; grading prompt is stable", () => {
    expect(worksheetPrompt(en, "m", ["Old question?"])).toContain("Old question?");
    expect(openGradePrompt("de", [{ id: "t1:0", prompt: "q", key: "k", rubric: ["r"], max: 2, answer: "a" }])).toContain("ID t1:0 (max 2 points)");
  });
});

describe("export", () => {
  it("markdown without and with the key", () => {
    const s = sheetOf();
    const plain = toMarkdown(s, { key: false });
    expect(plain).toContain("# Fotosynthese");
    expect(plain).toContain("Name: ______________");
    expect(plain).toContain("## Aufgabe 1: Ankreuzen (4 Punkte)");
    expect(plain).toContain("Wörter im Kasten: Licht · Wasser · Wind");
    expect(plain).toContain("(1) ______");
    expect(plain).toContain("Mindestpunkte");
    expect(plain).not.toContain("Lösungsblatt");
    const withKey = toMarkdown(s, { key: true });
    expect(withKey).toContain("Fotosynthese: Lösungsblatt");
    expect(withKey).toContain("**Licht**");
    expect(withKey).toContain("36");
    expect(withKey.indexOf("Lösungsblatt")).toBeGreaterThan(withKey.indexOf("Aufgabe 9"));
    const keyOnly = toMarkdown(s, { key: true, keyOnly: true });
    expect(keyOnly.startsWith("# Fotosynthese: Lösungsblatt")).toBe(true);
    expect(keyOnly).not.toContain("Name: ____");
  });

  it("English sheet uses English headers and the chosen answer labels", () => {
    const s = parseSheet(JSON.stringify({ tasks: [tasksJson[0]] }), { ...en, labelStyle: "ABC" });
    const md = toMarkdown(s, { key: false });
    expect(md).toContain("## Task 1: Multiple choice (4 Points)");
    expect(md).toContain("- A. Chloroplast");
    expect(toMarkdown(s, { key: true })).toContain("B. Zellkern");
    const boxes = toMarkdown({ ...s, options: { ...s.options, labelStyle: "box" } }, { key: false });
    expect(boxes).toContain("☐ Chloroplast");
  });

  it("docx is a zip with the sheet text and page size", async () => {
    const bytes = await toDocx(sheetOf(), { key: true });
    const zip = await JSZip.loadAsync(bytes);
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("Fotosynthese");
    expect(doc).toContain("Lösungsblatt");
    expect(doc).toContain("w:pageBreakBefore");
    expect(doc).toContain('w:w="11906"');
    const us = await JSZip.loadAsync(await toDocx({ ...sheetOf(), options: { ...de, paper: "letter" } }, { key: false }));
    expect(await us.file("word/document.xml")!.async("string")).toContain('w:w="12240"');
  });
});

describe("IHK layout", () => {
  it("puts gebundene Aufgaben first and labels both parts", () => {
    const ihk = optionsFor("ihk", "de");
    const s = parseSheet(JSON.stringify({ tasks: [tasksJson[6], tasksJson[0], tasksJson[7], tasksJson[2]] }), { ...ihk, mode: "length" });
    expect(s.tasks.map((t) => t.type)).toEqual(["choice", "cloze", "calc", "open"]);
    const md = toMarkdown(s, { key: false });
    expect(md).toContain("## Teil A: Gebundene Aufgaben");
    expect(md).toContain("## Teil B: Ungebundene Aufgaben");
    expect(md.indexOf("Teil A")).toBeLessThan(md.indexOf("Teil B"));
    expect(toMarkdown(parseSheet(JSON.stringify({ tasks: [tasksJson[0]] }), de), { key: false })).not.toContain("Teil A");
  });
});

describe("paper sheet", () => {
  it("reads answers from a photo's lines", () => {
    const s = sheetOf();
    const r = paperResponses(s, ["1.1: a", "1.2: a, b", "2.1: false", "2.2: richtig", "3.1: Licht | Wasser", "4.1: A | B | A | B", "5.1: 1 | 3 | 2", "7.1: 36", "8.1: Licht spaltet Wasser", "9.9: x", "garbage"]);
    expect(r.t1).toEqual([{ kind: "mc", choice: 0 }, { kind: "multi", choices: [0, 1] }]);
    expect(r.t2).toEqual([{ kind: "mc", choice: 1 }, { kind: "mc", choice: 0 }]);
    expect(r.t3[0]).toEqual({ kind: "cloze", texts: ["Licht", "Wasser"] });
    expect(r.t4[0]).toEqual({ kind: "drag", placed: [0, 1, 0, 1] });
    expect(r.t5[0]).toEqual({ kind: "drag", order: [0, 2, 1] });
    expect(r.t9).toBeUndefined();
    const attempt = { ...emptyAttempt(), responses: r };
    expect(scoreSheet(s, attempt).points).toBeGreaterThan(10);
  });
});
