import JSZip from "jszip";
import { partKey } from "./grade";
import { optionLabel, sheetLabels, type SheetLabels } from "./labels";
import { gradeFor, scaleRows } from "./presets";
import { totalPoints } from "./parse";
import type { LabelStyle, Part, Sheet, Task } from "./types";

export type Block =
  | { t: "title"; text: string }
  | { t: "meta"; fields: string[] }
  | { t: "h"; text: string }
  | { t: "p"; text: string; italic?: boolean }
  | { t: "li"; text: string; indent?: number }
  | { t: "lines"; n: number }
  | { t: "table"; rows: string[][] }
  | { t: "break" };

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

function gapText(text: string): string {
  return text.replace(/\{(\d+)\}/g, (_, n) => `(${n}) ______`);
}

function partBlocks(part: Part, l: SheetLabels, style: LabelStyle, withKey: boolean, task: Task, num: string): Block[] {
  const out: Block[] = [];
  switch (part.kind) {
    case "mc":
    case "multi": {
      out.push({ t: "p", text: `${num} ${part.prompt}` });
      part.options.forEach((o, i) => {
        const right = withKey && (part.kind === "mc" ? part.answer === i : part.answers.includes(i));
        const label = style === "box" ? (right ? "☒" : "☐") : optionLabel(style, i);
        out.push({ t: "li", text: `${label} ${o}${right && style !== "box" ? "  ✓" : ""}`, indent: 1 });
      });
      break;
    }
    case "cloze":
      out.push({ t: "p", text: `${num} ${withKey ? part.text.replace(/\{(\d+)\}/g, (_, n) => `**${part.blanks[Number(n) - 1]?.accepted[0] ?? ""}**`) : gapText(part.text)}` });
      break;
    case "fill":
      out.push({ t: "p", text: `${num} ${part.prompt}${withKey ? `  → ${part.accepted[0]}${part.explanation ? ` (${part.explanation})` : ""}` : ""}` });
      if (!withKey && task.type === "calc") out.push({ t: "p", text: `${l.workSpace}:`, italic: true }, { t: "lines", n: task.workLines ?? 4 });
      break;
    case "dropdown":
      out.push({ t: "p", text: `${num} ${part.prompt} ${withKey ? part.text.replace(/\{(\d+)\}/g, (_, n) => `**${part.blanks[Number(n) - 1]?.options[part.blanks[Number(n) - 1].answer]}**`) : gapText(part.text)}` });
      break;
    case "drag":
      if (part.mode === "order") {
        out.push({ t: "p", text: `${num} ${part.prompt}${withKey ? `  → ${(part.correctOrder ?? []).map((i) => part.items[i]).join(" → ")}` : ""}` });
        if (!withKey) part.items.forEach((it, i) => out.push({ t: "li", text: `__ ${it}`, indent: 1 + 0 * i }));
      } else {
        out.push({ t: "p", text: `${num} ${part.prompt}` });
        const cats = part.categories ?? [];
        cats.forEach((c, i) => out.push({ t: "li", text: `${optionLabel("ABC", i)} ${c}`, indent: 1 }));
        part.items.forEach((it, i) => out.push({ t: "li", text: `${it}  ${withKey ? "→ " + optionLabel("ABC", part.correctCategory?.[i] ?? 0).replace(".", "") : "→ ___"}`, indent: 1 }));
      }
      break;
    case "tablefill": {
      let gap = 0;
      out.push({ t: "p", text: num });
      out.push({
        t: "table",
        rows: [part.columns, ...part.rows.map((r) => r.map((c) => (c === "" ? (withKey ? `**${part.blanks[gap++]?.accepted[0] ?? ""}**` : "______") : c)))],
      });
      break;
    }
    case "open":
      out.push({ t: "p", text: `${num} ${part.prompt}` });
      if (withKey) {
        out.push({ t: "p", text: part.key });
        part.rubric.forEach((r) => out.push({ t: "li", text: r, indent: 1 }));
      } else out.push({ t: "lines", n: part.lines });
      break;
    case "hotspot":
      out.push({ t: "p", text: `${num} ${part.prompt}` });
      break;
  }
  return out;
}

function stimulusBlocks(part: Part): Block[] {
  if (!("stimulus" in part) || !part.stimulus) return [];
  const s = part.stimulus;
  if (s.type === "passage") return [{ t: "p", text: s.text, italic: true }];
  if (s.type === "table") return [{ t: "table", rows: [s.columns, ...s.rows] }];
  if (s.type === "chart") {
    const c = s.chart;
    return c.type === "scatter" ? [{ t: "table", rows: [["x", "y"], ...c.series.flatMap((x) => x.points.map((p) => p.map(String)))] }] : [{ t: "table", rows: [["", ...c.series.map((x) => x.name)], ...c.categories.map((cat, i) => [cat, ...c.series.map((x) => String(x.values[i]))])] }];
  }
  return [];
}

export interface BlockOptions {
  key?: boolean;
  /** the sheet itself, the key sheet, or both (key starts on a new page) */
  withSheet?: boolean;
}

export function sheetBlocks(sheet: Sheet, opts: BlockOptions = {}): Block[] {
  const l = sheetLabels(sheet.options.language);
  const style = sheet.options.labelStyle;
  const total = totalPoints(sheet.tasks);
  const out: Block[] = [];
  const body = (withKey: boolean) => {
    sheet.tasks.forEach((task, ti) => {
      out.push({ t: "h", text: `${l.task} ${ti + 1}: ${l.types[task.type]} (${pts(task.points)} ${l.points})` });
      out.push({ t: "p", text: task.correctFalse ? `${task.instruction} ${l.correctFalse}` : task.instruction, italic: true });
      if (task.passage) out.push({ t: "p", text: task.passage });
      if (task.bank?.length) out.push({ t: "p", text: `${l.wordBank}: ${[...task.bank].sort((a, b) => a.localeCompare(b)).join(" · ")}` });
      task.parts.forEach((part, pi) => {
        out.push(...stimulusBlocks(part));
        const num = task.parts.length > 1 ? `${ti + 1}.${pi + 1}` : `${ti + 1}.`;
        out.push(...partBlocks(part, l, style, withKey, task, num));
        if (task.correctFalse && !withKey) out.push({ t: "p", text: `${l.correct}:` }, { t: "lines", n: 1 });
        if (withKey && "explanation" in part && part.explanation && part.kind !== "fill") out.push({ t: "p", text: part.explanation, italic: true });
      });
    });
  };
  if (opts.withSheet !== false && !opts.key) {
    out.push({ t: "title", text: sheet.title });
    out.push({ t: "meta", fields: [l.name, l.className, l.date] });
    if (sheet.instructions) out.push({ t: "p", text: sheet.instructions });
    out.push({ t: "p", text: `${l.total}: ____ ${l.from} ${pts(total)} ${l.points}`, italic: true });
    body(false);
    const rows = scaleRows(sheet.options.scale, total);
    if (rows.length) out.push({ t: "h", text: l.gradeScale }, { t: "table", rows: [[l.grade, l.scaleHeader], ...rows.map((r) => [r.grade, r.min === r.max ? pts(r.min) : `${pts(r.min)} – ${pts(r.max)}`])] });
  }
  if (opts.key) {
    if (opts.withSheet !== false) out.push({ t: "break" });
    out.push({ t: "title", text: `${sheet.title}: ${l.keyTitle}` });
    out.push({ t: "p", text: `${l.total}: ${pts(total)} ${l.points}`, italic: true });
    body(true);
  }
  return out;
}

export function toMarkdown(sheet: Sheet, opts: { key: boolean; keyOnly?: boolean }): string {
  const blocks = opts.keyOnly ? sheetBlocks(sheet, { key: true, withSheet: false }) : opts.key ? [...sheetBlocks(sheet), ...sheetBlocks(sheet, { key: true, withSheet: true })] : sheetBlocks(sheet);
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "title":
        lines.push(`# ${b.text}`, "");
        break;
      case "meta":
        lines.push(b.fields.map((f) => `${f}: ______________`).join("    "), "");
        break;
      case "h":
        lines.push(`## ${b.text}`, "");
        break;
      case "p":
        lines.push(b.italic ? `*${b.text}*` : b.text, "");
        break;
      case "li":
        lines.push(`${"  ".repeat(b.indent ?? 0)}- ${b.text}`);
        break;
      case "lines":
        lines.push("", ...Array.from({ length: b.n }, () => "______________________________________________"), "");
        break;
      case "table":
        lines.push(`| ${b.rows[0].join(" | ")} |`, `| ${b.rows[0].map(() => "---").join(" | ")} |`, ...b.rows.slice(1).map((r) => `| ${r.join(" | ")} |`), "");
        break;
      case "break":
        lines.push("", "---", "");
        break;
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const xml = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function runs(text: string, italic = false, bold = false): string {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts
    .filter((p) => p !== "")
    .map((p) => {
      const b = /^\*\*[^*]+\*\*$/.test(p);
      const t = b ? p.slice(2, -2) : p;
      return `<w:r><w:rPr>${bold || b ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}</w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
    })
    .join("");
}

const para = (inner: string, o: { indent?: number; style?: string; pageBreak?: boolean; keep?: boolean } = {}) =>
  `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.keep ? "<w:keepNext/>" : ""}${o.pageBreak ? "<w:pageBreakBefore/>" : ""}${o.indent ? `<w:ind w:left="${o.indent * 360}"/>` : ""}</w:pPr>${inner}</w:p>`;

function docxBody(blocks: Block[]): string {
  const out: string[] = [];
  let pendingBreak = false;
  for (const b of blocks) {
    const pb = pendingBreak;
    if (b.t !== "break") pendingBreak = false;
    switch (b.t) {
      case "title":
        out.push(para(runs(b.text), { style: "Title", pageBreak: pb }));
        break;
      case "meta":
        out.push(para(runs(b.fields.map((f) => `${f}: ____________________`).join("     "))));
        break;
      case "h":
        out.push(para(runs(b.text), { style: "Heading2", keep: true }));
        break;
      case "p":
        out.push(para(runs(b.text, b.italic)));
        break;
      case "li":
        out.push(para(runs(b.text), { indent: (b.indent ?? 0) + 1 }));
        break;
      case "lines":
        for (let i = 0; i < b.n; i++) out.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="12" w:color="999999"/></w:pBdr><w:spacing w:before="240"/></w:pPr></w:p>`);
        break;
      case "table": {
        const cell = (c: string, head: boolean) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${para(runs(c, false, head))}</w:tc>`;
        out.push(
          `<w:tbl><w:tblPr><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="999999"/>`).join("")}</w:tblBorders></w:tblPr>${b.rows
            .map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c) => cell(c, ri === 0)).join("")}</w:tr>`)
            .join("")}</w:tbl>`,
          para(""),
        );
        break;
      }
      case "break":
        pendingBreak = true;
        break;
    }
  }
  return out.join("");
}

/** A plain .docx: title, headings, tasks, answer lines, tables and, when asked, the key on its own page. */
export async function toDocx(sheet: Sheet, opts: { key: boolean; keyOnly?: boolean }): Promise<Uint8Array> {
  const blocks = opts.keyOnly ? sheetBlocks(sheet, { key: true, withSheet: false }) : opts.key ? [...sheetBlocks(sheet), ...sheetBlocks(sheet, { key: true, withSheet: true })] : sheetBlocks(sheet);
  const a4 = sheet.options.paper === "a4";
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file(
    "word/styles.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docxBody(blocks)}<w:sectPr><w:pgSz w:w="${a4 ? 11906 : 12240}" w:h="${a4 ? 16838 : 15840}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** One-line result for the score banner and mistake notes. */
export function resultLine(sheet: Sheet, points: number): { grade: string | null; total: number } {
  const total = totalPoints(sheet.tasks);
  const g = gradeFor(sheet.options.scale, total ? points / total : 0);
  return { grade: g?.label ?? null, total };
}

export { partKey };
