import JSZip from "jszip";
import type { MindNode, Slide, TableData, TimelineData, WorksheetData } from "./kinds";

export function toCsv(columns: string[], rows: string[][]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const xml = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function columnName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** A minimal .xlsx (one sheet, bold header row, numbers stored as numbers). */
export async function toXlsx(t: TableData, sheetName = "Sheet1"): Promise<Uint8Array> {
  const cellXml = (v: string, r: number, c: number, header: boolean) => {
    const ref = `${columnName(c)}${r + 1}`;
    if (!header && NUMERIC.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const rows = [t.columns, ...t.rows]
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cellXml(v, r, c, r === 0)).join("")}</row>`)
    .join("");
  const name = xml(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file(
    "xl/styles.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

export async function toPptx(title: string, slides: Slide[]): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = title;
  const font = "Helvetica";
  slides.forEach((sl, i) => {
    const slide = pptx.addSlide();
    if (i === 0 && sl.bullets.length === 0) {
      slide.addText(sl.title, { x: 0.6, y: 2.0, w: 8.8, h: 1.2, fontFace: font, fontSize: 36, bold: true, color: "1F1F1F" });
    } else {
      slide.addText(sl.title, { x: 0.6, y: 0.4, w: 8.8, h: 0.8, fontFace: font, fontSize: 26, bold: true, color: "1F1F1F" });
      slide.addText(
        sl.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: 1.35, w: 8.8, h: 3.8, fontFace: font, fontSize: 18, color: "3A3A3A", valign: "top", paraSpaceAfter: 8 },
      );
    }
    if (sl.notes) slide.addNotes(sl.notes);
  });
  const out = await pptx.write({ outputType: "uint8array" });
  return out as Uint8Array;
}

export function worksheetMarkdown(title: string, w: WorksheetData, withKey: boolean): string {
  const qs = w.questions.map((q, i) => {
    const opts = q.kind === "choice" && q.options ? "\n" + q.options.map((o, j) => `   ${String.fromCharCode(97 + j)}) ${o}`).join("\n") : "";
    return `${i + 1}. ${q.q}${opts}`;
  });
  const key = withKey ? `\n\n## Answer key\n\n${w.questions.map((q, i) => `${i + 1}. ${q.answer}`).join("\n")}` : "";
  return `# ${title}\n\n${w.instructions ? w.instructions + "\n\n" : ""}${qs.join("\n\n")}${key}\n`;
}

export function timelineMarkdown(title: string, t: TimelineData): string {
  return `# ${title}\n\n${t.events.map((e) => `- **${e.date}**: ${e.title}${e.detail ? `. ${e.detail}` : ""}`).join("\n")}\n`;
}

export function mindmapMarkdown(root: MindNode): string {
  const lines: string[] = [`# ${root.label}`];
  const walk = (n: MindNode, depth: number) => {
    for (const c of n.children) {
      lines.push(`${"  ".repeat(depth)}- ${c.label}`);
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n") + "\n";
}

export function slidesMarkdown(title: string, slides: Slide[]): string {
  return `# ${title}\n\n${slides.map((sl) => `## ${sl.title}\n\n${sl.bullets.map((b) => `- ${b}`).join("\n")}${sl.notes ? `\n\n> ${sl.notes}` : ""}`).join("\n\n")}\n`;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

/** Inlines computed colors so an SVG that uses theme CSS variables looks the same outside the app. */
export function standaloneSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll<SVGElement>("*");
  const dst = clone.querySelectorAll<SVGElement>("*");
  const props = ["fill", "stroke", "color", "font-family", "font-size", "font-weight", "opacity", "stroke-width"];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const style = props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
    dst[i].setAttribute("style", style);
    dst[i].removeAttribute("class");
  });
  clone.removeAttribute("class");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const bg = getComputedStyle(svg).backgroundColor;
  if (bg && bg !== "rgba(0, 0, 0, 0)") clone.setAttribute("style", `background:${bg}`);
  return new XMLSerializer().serializeToString(clone);
}

export async function svgToPng(svgText: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("SVG render failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("PNG export failed");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
