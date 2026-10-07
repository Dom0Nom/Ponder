import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { deepResearch, type FoundSource, type ResearchStage } from "../../lib/research/deepResearch";
import { proxyHttp } from "../../lib/importers/http";
import { ActivityOrb, type Activity } from "../../components/motion/ActivityOrb";
import { Button } from "../../components/ui/button";
import { Checkbox16 } from "../../components/ui/Checkbox16";
import { Input } from "../../components/ui/input";
import { EmptyState } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { useImportFooter } from "./ImportDialog";

const STAGE_ORB: Record<ResearchStage, Activity> = { planning: "plan", searching: "search", fetching: "research", ranking: "grade", done: "research" };

const STAGE_LABEL: Record<ResearchStage, string> = {
  planning: s.research.planning,
  searching: s.research.searching,
  fetching: s.research.fetching,
  ranking: s.research.ranking,
  done: "",
};

export function ResearchPanel({ space, done, initialQuery }: { space: Space; done: () => void; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery ?? "");
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

  useImportFooter({
    label: found?.length ? s.research.importSelected(selected.size) : s.sources.import,
    disabled: !found?.length || !selected.size,
    busy: importing,
    run: importSelected,
  });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim() && !stage) run();
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.research.placeholder} aria-label={s.research.placeholder} className="flex-1" />
          <Button type="submit" variant="secondary" disabled={!q.trim() || !!stage}>
            {s.research.start}
          </Button>
        </form>
        <p className="text-label text-muted">{s.research.hint}</p>
      </div>

      {stage && (
        <div data-testid="research-running" data-stage={stage} className="flex items-center gap-3 rounded-card border border-border px-4 py-3" aria-live="polite">
          <ActivityOrb activity={STAGE_ORB[stage]} size={32} />
          <div className="min-w-0">
            <p className="font-medium">{STAGE_LABEL[stage]}</p>
            {detail && <p className="truncate text-label text-muted">{detail}</p>}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => abort.current?.abort()}>
            {s.common.cancel}
          </Button>
        </div>
      )}

      {found && found.length === 0 && <EmptyState title={s.research.noResults} />}
      {found && found.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-semibold">{s.research.reviewTitle}</p>
          <p className="mb-1 text-body leading-[1.5] text-muted">{s.research.reviewBody}</p>
          <ul className="rounded-card border border-border px-3.5" data-testid="research-results">
            {found.map((f) => {
              const host = new URL(f.url).hostname.replace(/^www\./, "");
              return (
                <li key={f.id} className="group flex h-[42px] items-center gap-2.5 border-divider [&+&]:border-t">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5" title={f.summary}>
                    <Checkbox16
                      checked={selected.has(f.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(f.id);
                        else next.delete(f.id);
                        setSelected(next);
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{`${f.title} – ${host}`}</span>
                  </label>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${s.research.openLink}: ${host}`}
                    className="hidden text-muted hover:text-fg focus:block group-hover:block"
                  >
                    <ExternalLink size={13} />
                  </a>
                  <Credibility value={f.credibility} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Credibility({ value }: { value: number }) {
  const level = value >= 75 ? s.research.levels.high : value >= 50 ? s.research.levels.medium : s.research.levels.low;
  return (
    <span title={String(value)} className="shrink-0 text-label text-muted">
      {s.research.credibility}: {level}
    </span>
  );
}
