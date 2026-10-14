import { useState, type ReactNode } from "react";
import { Loader2, Play, X } from "lucide-react";
import { runC, C_INSTALL_HINT } from "../../lib/codecell/c";
import type { CRun } from "../../lib/types";
import { s } from "../../lib/strings";
import { actionTextBtn } from "./actionButton";

type State = { status: "idle" } | { status: "running" } | { status: "done"; run: CRun } | { status: "failed"; message: string };

export function CCodeCell({ code, children }: { code: string; children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [stdin, setStdin] = useState("");
  const [showInput, setShowInput] = useState(false);
  const run = async () => {
    setState({ status: "running" });
    try {
      setState({ status: "done", run: await runC(code, stdin) });
    } catch (e) {
      setState({ status: "failed", message: s.codeCell.failed(e instanceof Error ? e.message : String(e)) });
    }
  };
  const r = state.status === "done" ? state.run : null;
  const lines = code.split("\n");
  return (
    <div className="code-cell my-[0.9em]" data-testid="code-cell" data-lang="c" data-state={state.status}>
      <div className="relative">
        {children}
        <button
          type="button"
          className={`${actionTextBtn} absolute end-1.5 top-1.5 h-6 bg-surface px-2 text-[12px] text-fg-secondary shadow-sm`}
          onClick={run}
          disabled={state.status === "running"}
          aria-label={s.codeCell.run(s.codeCell.lang.c)}
          data-testid="cell-run"
        >
          {state.status === "running" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {s.codeCell.runShort}
        </button>
      </div>
      <button type="button" className="mt-1 text-[12px] text-muted hover:text-fg" onClick={() => setShowInput((v) => !v)} aria-expanded={showInput} data-testid="c-input-toggle">
        {s.codeC.input}
      </button>
      {showInput && (
        <textarea
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
          placeholder={s.codeC.inputPlaceholder}
          aria-label={s.codeC.input}
          rows={2}
          className="mt-1 block w-full rounded-[8px] border border-border bg-surface px-3 py-2 font-mono text-[12.5px]"
          data-testid="c-stdin"
        />
      )}
      {state.status === "running" && (
        <p className="mt-1.5 text-[12px] text-muted" role="status">
          {s.codeC.compiling}
        </p>
      )}
      {state.status === "failed" && (
        <p className="mt-1.5 text-[12px] text-danger" role="alert" data-testid="cell-output" data-ok="false">
          {state.message}
        </p>
      )}
      {r && (
        <div className="mt-1.5 rounded-[8px] border border-border bg-surface" data-testid="cell-output" data-ok={r.ok} data-stage={r.stage}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-[11px] text-muted">
            <span>{r.stage === "none" ? s.codeCell.errorTitle : r.stage === "compile" ? s.codeC.compileError : r.ok ? s.codeCell.outputMs(Math.max(1, r.runMs)) : s.codeCell.errorTitle}</span>
            <button type="button" className="ms-auto rounded p-0.5 hover:bg-fill hover:text-fg" onClick={() => setState({ status: "idle" })} aria-label={s.codeCell.clear}>
              <X size={12} />
            </button>
          </div>
          <div className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12.5px]" data-testid="cell-text">
            {r.stage === "none" && (
              <span className="text-danger" data-testid="c-no-compiler">
                {s.codeC.noCompiler}
                {"\n"}
                {s.codeC.install(C_INSTALL_HINT.mac, C_INSTALL_HINT.linux, C_INSTALL_HINT.windows)}
              </span>
            )}
            {r.stage === "compile" &&
              (r.diagnostics.length > 0 ? (
                <ul className="flex flex-col gap-1.5" data-testid="c-diagnostics">
                  {r.diagnostics
                    .filter((d) => d.severity !== "note")
                    .map((d, i) => (
                      <li key={i} data-line={d.line}>
                        <span className={d.severity === "error" ? "text-danger" : "text-fg-secondary"}>
                          {s.codeC.line(d.line)}: {d.message}
                        </span>
                        <span className="block text-muted">{lines[d.line - 1]?.trim()}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <span className="text-danger">{r.output}</span>
              ))}
            {r.stage === "run" && (
              <>
                {r.output && <span>{r.output}</span>}
                {r.truncated && <span className="block text-muted">{s.codeC.truncated}</span>}
                {r.timedOut && <span className="block text-danger">{s.codeC.timedOut}</span>}
                {!r.timedOut && !r.ok && <span className="block text-danger">{s.codeC.exit(r.exitCode ?? -1)}</span>}
                {!r.output && r.ok && <span className="text-muted">{s.codeCell.noOutput}</span>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export type { ReactNode };
