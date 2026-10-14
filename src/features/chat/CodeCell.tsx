import { useState, type ReactNode } from "react";
import { Loader2, Play, X } from "lucide-react";
import type { CellLang, CellResult } from "../../lib/codecell/lang";
import { CellTimeout, runCell } from "../../lib/codecell/run";
import { s } from "../../lib/strings";
import { actionTextBtn } from "./actionButton";

type State = { status: "idle" } | { status: "running"; booting: boolean } | { status: "done"; result: CellResult };

let pythonLoaded = false;

export function CodeCell({ lang, code, children }: { lang: CellLang; code: string; children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const run = async () => {
    setState({ status: "running", booting: lang === "python" && !pythonLoaded });
    try {
      const result = await runCell(lang, code);
      if (lang === "python") pythonLoaded = true;
      setState({ status: "done", result });
    } catch (e) {
      if (lang === "python") pythonLoaded = false;
      const error = e instanceof CellTimeout ? s.codeCell.timeout(e.seconds) : s.codeCell.failed(e instanceof Error ? e.message : String(e));
      setState({ status: "done", result: { ok: false, output: "", error, ms: 0 } });
    }
  };
  const result = state.status === "done" ? state.result : null;
  return (
    <div className="code-cell my-[0.9em]" data-testid="code-cell" data-lang={lang} data-state={state.status}>
      <div className="relative">
        {children}
        <button
          type="button"
          className={`${actionTextBtn} absolute end-1.5 top-1.5 h-6 bg-surface px-2 text-[12px] text-fg-secondary shadow-sm`}
          onClick={run}
          disabled={state.status === "running"}
          aria-label={s.codeCell.run(s.codeCell.lang[lang])}
          data-testid="cell-run"
        >
          {state.status === "running" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {s.codeCell.runShort}
        </button>
      </div>
      {state.status === "running" && (
        <p className="mt-1.5 text-[12px] text-muted" role="status">
          {state.booting ? s.codeCell.booting : s.codeCell.running}
        </p>
      )}
      {result && (
        <div className="mt-1.5 rounded-[8px] border border-border bg-surface" data-testid="cell-output" data-ok={result.ok}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-[11px] text-muted">
            <span>{result.ok ? result.ms < 1000 ? s.codeCell.outputMs(Math.max(1, Math.round(result.ms))) : s.codeCell.outputSec(Math.round(result.ms / 100) / 10) : s.codeCell.errorTitle}</span>
            <button type="button" className="ms-auto rounded p-0.5 hover:bg-fill hover:text-fg" onClick={() => setState({ status: "idle" })} aria-label={s.codeCell.clear}>
              <X size={12} />
            </button>
          </div>
          <div className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12.5px]" data-testid="cell-text">
            {result.output && <span>{result.output}</span>}
            {result.output && result.error && "\n"}
            {result.error && <span className="text-danger">{result.error}</span>}
            {!result.output && !result.error && <span className="text-muted">{s.codeCell.noOutput}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
