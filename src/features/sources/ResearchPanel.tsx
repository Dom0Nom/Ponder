import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Sparkles } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { deepResearch, type FoundSource, type ResearchStage } from "../../lib/research/deepResearch";
import { proxyHttp } from "../../lib/importers/http";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { EmptyState, Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";

const STAGE_LABEL: Record<ResearchStage, string> = {
  planning: s.research.planning,
  searching: s.research.searching,
  fetching: s.research.fetching,
  ranking: s.research.ranking,
  done: "",
};

export function ResearchPanel({ space, done }: { space: Space; done: () => void }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<ResearchStage | null>(null);
  const [detail, setDetail] = useState("");
  const [found, setFound] = useState<FoundSource[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  const run = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFound(null);
    setStage("planning");
    try {
      const llm = await resolveChatModel(space);
      const res = await deepResearch(q, {
        llm,
        http: proxyHttp,
        signal: ctrl.signal,
        onStage: (st, d) => {
          setStage(st);
          setDetail(d ?? "");
        },
      });
      setFound(res);
      setSelected(new Set(res.map((r) => r.id)));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof NoModelError) toastError(s.research.needModel, null);
      else toastError("Deep research failed", e, run);
    } finally {
      if (abort.current === ctrl) setStage(null);
    }
  };

  const importSelected = async () => {
    if (!found) return;
    setImporting(true);
    const picks = found.filter((f) => selected.has(f.id));
    const failed: string[] = [];
    for (const f of picks) {
      try {
        await api.importText(space.id, f.title, `# ${f.title}\n\nSource: ${f.url}\n\n${f.markdown}`, "url", f.url);
      } catch (e) {
        failed.push(`${f.title}: ${(e as Error).message}`);
      }
    }
    qc.invalidateQueries({ queryKey: qk.sources(space.id) });
    setImporting(false);
    if (failed.length) toastError(s.sources.importFailed, new Error(failed.join("\n")));
    if (failed.length < picks.length) {
      toast.success(`Imported ${picks.length - failed.length} sources`);
      done();
    }
  };

  return (
    <div className="pb-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) run();
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.research.placeholder} aria-label={s.research.placeholder} />
        <Button type="submit" variant="primary" disabled={!q.trim() || !!stage}>
          <Sparkles size={16} /> {s.research.start}
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted">
        Searches DuckDuckGo, Wikipedia, arXiv and OpenAlex, reads the pages and rates them with your chat model.
      </p>

      {stage && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm" aria-live="polite">
          <Spinner />
          <div className="min-w-0">
            <p className="font-medium">{STAGE_LABEL[stage]}</p>
            {detail && <p className="truncate text-xs text-muted">{detail}</p>}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => abort.current?.abort()}>
            {s.common.cancel}
          </Button>
        </div>
      )}

      {found && found.length === 0 && <EmptyState title={s.research.noResults} />}
      {found && found.length > 0 && (
        <div className="mt-5">
          <p className="font-medium">{s.research.reviewTitle}</p>
          <p className="text-xs text-muted">{s.research.reviewBody}</p>
          <ul className="mt-3 space-y-2" data-testid="research-results">
            {found.map((f) => (
              <li key={f.id}>
                <label className="flex cursor-pointer gap-3 rounded-2xl border border-border p-3 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    checked={selected.has(f.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(f.id);
                      else next.delete(f.id);
                      setSelected(next);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium">{f.title}</p>
                      <Credibility value={f.credibility} />
                    </div>
                    <p className="mt-1 text-xs text-muted">{f.summary}</p>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[0.6875rem] text-faint hover:text-accent-text"
                    >
                      <ExternalLink size={11} className="shrink-0" />
                      <span className="truncate">{new URL(f.url).hostname.replace(/^www\./, "")}</span>
                    </a>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" disabled={!selected.size || importing} onClick={importSelected}>
              {importing && <Spinner size={15} className="text-on-accent" />} {s.research.importSelected(selected.size)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Credibility({ value }: { value: number }) {
  const tone = value >= 75 ? "bg-accent-soft text-accent-text" : value >= 50 ? "bg-surface-3 text-muted" : "bg-warn-soft text-warn";
  return (
    <span title={s.research.credibility} className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums", tone)}>
      {s.research.credibility} {value}
    </span>
  );
}
