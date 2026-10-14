import { Fragment, type ReactNode } from "react";
import { footBlocks, headBlocks, taskBlocks, type Block } from "../../lib/worksheets/export";
import type { Sheet } from "../../lib/worksheets/types";

const inline = (text: string): ReactNode =>
  text.split(/(\*\*[^*]+\*\*)/).map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "title":
      return <h1 className="pb-2 text-page font-semibold">{b.text}</h1>;
    case "meta":
      return (
        <div className="flex gap-6 pb-3">
          {b.fields.map((f) => (
            <span key={f} className="flex flex-1 items-end gap-2 border-b border-fg pb-0.5 text-body">
              {f}:
            </span>
          ))}
        </div>
      );
    case "h":
      return <h2 className="pt-3 text-title font-semibold">{b.text}</h2>;
    case "p":
      return <p className={b.italic ? "italic text-fg-secondary" : undefined}>{inline(b.text)}</p>;
    case "li":
      return <p style={{ paddingInlineStart: `${(b.indent ?? 0) * 1.25}rem` }}>{inline(b.text)}</p>;
    case "lines":
      return (
        <div aria-hidden>
          {Array.from({ length: b.n }, (_, i) => (
            <div key={i} className="h-8 border-b border-border-hover" />
          ))}
        </div>
      );
    case "table":
      return (
        <table className="border-collapse text-body">
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className={`border border-border-hover px-2.5 py-1.5 ${ri === 0 ? "font-semibold" : ""}`}>
                    {inline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "break":
      return null;
  }
}

/** The printed sheet: header fields, numbered tasks that never split across pages, and the key on its own page. */
export function SheetPrint({ sheet, withKey }: { sheet: Sheet; withKey: boolean }) {
  const paper = sheet.options.paper === "a4" ? "A4" : "letter";
  return (
    <div className="hidden flex-col gap-3 print:flex" data-testid="sheet-print" data-paper={paper}>
      <style>{`@media print { @page { size: ${paper}; margin: 16mm; } }`}</style>
      <div className="flex flex-col gap-2">
        {headBlocks(sheet, false).map((b, i) => (
          <BlockView key={i} b={b} />
        ))}
      </div>
      {sheet.tasks.map((t, ti) => (
        <section key={t.id} className="break-inside-avoid flex flex-col gap-2">
          {taskBlocks(sheet, ti, false).map((b, i) => (
            <BlockView key={i} b={b} />
          ))}
        </section>
      ))}
      <div className="break-inside-avoid flex flex-col gap-2">
        {footBlocks(sheet).map((b, i) => (
          <BlockView key={i} b={b} />
        ))}
      </div>
      {withKey && (
        <div className="flex break-before-page flex-col gap-3" data-testid="sheet-print-key">
          {headBlocks(sheet, true).map((b, i) => (
            <BlockView key={i} b={b} />
          ))}
          {sheet.tasks.map((t, ti) => (
            <section key={t.id} className="break-inside-avoid flex flex-col gap-2">
              {taskBlocks(sheet, ti, true).map((b, i) => (
                <BlockView key={i} b={b} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
