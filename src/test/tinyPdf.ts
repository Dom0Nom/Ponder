/** Builds a small valid PDF (Helvetica text, one page per entry) for the mocked backend. */
export function tinyPdf(pages: string[]): Uint8Array {
  const wrap = (text: string) =>
    text
      .split("\n")
      .flatMap((para) => {
        const out: string[] = [];
        let line = "";
        for (const word of para.split(/\s+/).filter(Boolean)) {
          if (line && (line + " " + word).length > 70) {
            out.push(line);
            line = word;
          } else line = line ? `${line} ${word}` : word;
        }
        return [...out, line];
      });
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const lines = wrap(text);
    const body = `BT /F1 12 Tf 16 TL 56 780 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
    objs[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objs[pageIds[i] + 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
