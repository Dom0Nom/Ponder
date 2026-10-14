import { useMemo, type CSSProperties } from "react";
import katex from "katex";
import { X } from "lucide-react";
import { s } from "../../lib/strings";
import type { FormulaSheetId } from "../../lib/exam/formats";
import { FORMULA_SHEETS } from "../../lib/exam/formulas";
import { Button } from "../../components/ui/button";

const render = (tex: string) => {
  try {
    return katex.renderToString(tex, { throwOnError: true, displayMode: false });
  } catch {
    return null;
  }
};

function Formula({ tex }: { tex: string }) {
  const html = useMemo(() => render(tex), [tex]);
  return html ? <span dir="ltr" className="[&_.katex]:text-[1em]" dangerouslySetInnerHTML={{ __html: html }} /> : <code dir="ltr">{tex}</code>;
}

export function FormulaSheet({ sheet, onClose }: { sheet: FormulaSheetId; onClose: () => void }) {
  const t = s.gedExam.sheet;
  return (
    <aside
      className="t-panel-slide flex w-[300px] shrink-0 flex-col border-s border-border bg-surface"
      data-open="true"
      data-testid="formula-sheet"
      aria-label={t.title}
      style={{ "--panel-translate-x": "32px", "--panel-translate-y": "0px" } as CSSProperties}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-title-sm font-semibold">{t.title}</h2>
        <Button variant="ghost-muted" size="icon-sm" className="ms-auto" aria-label={t.close} onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {FORMULA_SHEETS[sheet].map((g) => (
          <section key={g.id} className="flex flex-col gap-2" data-group={g.id}>
            <h3 className="text-label font-semibold text-muted">{t.groups[g.id]}</h3>
            <ul className="flex flex-col gap-1.5">
              {g.items.map((it) => (
                <li key={it.id} className="flex flex-col gap-0.5">
                  <span className="text-label text-fg-secondary">{t.items[`${g.id}.${it.id}`] ?? it.id}</span>
                  <Formula tex={it.tex} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {sheet === "math" ? <p className="text-label text-muted">{t.piNote}</p> : null}
      </div>
    </aside>
  );
}
