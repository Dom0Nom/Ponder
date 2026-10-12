import { lazy, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { NoModelError } from "../../lib/chat/llm";
import { resolveResearch } from "../../lib/research/config";
import { contextKey, generateResearchQuery, queryCache, sharedQuery } from "../../lib/research/prompts";
import { writeReport, type FoundSource, type ResearchStage } from "../../lib/research/deepResearch";
import type { FinishedReport } from "../../lib/research/reportPrompts";
import { useResearch } from "../../stores/research";
import { Reveal } from "../../components/motion/Reveal";
import { TextSwap } from "../../components/motion/TextSwap";
import { Fx } from "../../components/fx/Fx";
import { ActivityOrb, type Activity } from "../../components/motion/ActivityOrb";
import { Button } from "../../components/ui/button";
import { Checkbox16 } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { EmptyState, Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { useImportFooter } from "./ImportDialog";

const ResearchBeam = lazy(() => import("../../components/fx/ResearchBeam"));

const STAGE_ORB: Record<ResearchStage, Activity> = {
  planning: "plan",
  searching: "search",
  fetching: "research",
  ranking: "grade",
  gaps: "plan",
  done: "research",
};

const STAGE_LABEL: Record<ResearchStage, string> = {
  planning: s.research.planning,
  searching: s.research.searching,
  fetching: s.research.fetching,
  ranking: s.research.ranking,
  gaps: s.research.gaps,
  done: "",
};

export function ResearchPanel({
  space,
  done,
  initialQuery,
  initialFound,
}: {
  space: Space;
  done: () => void;
  initialQuery?: string;
  initialFound?: FoundSource[];
}) {
  const run = useResearch((st) => st.runs[space.id]);
  const [q, setQ] = useState(initialQuery ?? run?.query ?? "");
  const stage = run?.status === "running" ? run.stage : null;
  const detail = run?.stage === "searching" && run.round > 1 ? s.research.round(run.round, run.detail) : (run?.detail ?? "");
  const found: FoundSource[] | null = run?.results ?? initialFound ?? null;
  const [selected, setSelected] = useState<Set<string>>(new Set(found?.map((f) => f.id)));
  const [importing, setImporting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [report, setReport] = useState<FinishedReport | null>(null);
  const [writing, setWriting] = useState(false);
  const [reportImporting, setReportImporting] = useState(false);
  const reportAbort = useRef<AbortController | null>(null);
  const suggestAbort = useRef<AbortController | null>(null);
  const typed = useRef(false);
  const qc = useQueryClient();

  const suggest = async (force: boolean) => {
    suggestAbort.current?.abort();
    const ctrl = new AbortController();
    suggestAbort.current = ctrl;
    setSuggesting(true);
    try {
      const [{ llm, systemPrompt }, sources, threads, curriculum] = await Promise.all([
        resolveResearch(space),
        api.listSources(space.id),
        api.listThreads(space.id),
        api.curriculumGet(space.id),
      ]);
      const ctx = { name: space.name, sources, curriculum, threads: [...threads].sort((a, b) => b.updatedAt - a.updatedAt) };
      const key = contextKey(ctx, `${llm.provider.id}/${llm.modelId}|${systemPrompt}`);
      const text = (!force && queryCache.get(space.id, key)) || (await sharedQuery(space.id, key, () => generateResearchQuery(ctx, { llm, systemPrompt })));
      queryCache.set(space.id, key, text);
      if (!ctrl.signal.aborted && (force || !typed.current)) setQ(text);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (!typed.current) setQ(space.name);
      if (!(e instanceof NoModelError)) toastError(s.research.suggestFailed, e, () => suggest(true));
    } finally {
      if (suggestAbort.current === ctrl) setSuggesting(false);
    }
  };

  useEffect(() => {
    if (!initialQuery && !run) suggest(false);
    return () => {
      suggestAbort.current?.abort();
      reportAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = run?.results;
  useEffect(() => {
    if (results) {
      setSelected(new Set(results.map((r) => r.id)));
      setReport(null);
    }
  }, [results]);

  const start = () => {
    setReport(null);
    void useResearch.getState().start(space, q);
  };

  const makeReport = async () => {
    if (!found) return;
    reportAbort.current?.abort();
    const ctrl = new AbortController();
    reportAbort.current = ctrl;
    setWriting(true);
    try {
      const { llm, systemPrompt } = await resolveResearch(space);
      const picks = found.filter((f) => selected.has(f.id));
      const r = await writeReport(run?.query ?? q, picks, { llm, systemPrompt, signal: ctrl.signal });
      if (!ctrl.signal.aborted) setReport(r);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof NoModelError) toastError(s.research.needModel, null);
      else toastError(s.research.reportFailed, e, makeReport);
    } finally {
      if (reportAbort.current === ctrl) setWriting(false);
    }
  };

  const importReport = async () => {
    if (!report) return;
    setReportImporting(true);
    try {
      await api.importText(space.id, s.research.reportTitleFor(run?.query ?? q), report.markdown, "text");
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
      toast.success(s.research.reportImported);
      setReport(null);
    } catch (e) {
      toastError(s.sources.importFailed, e, importReport);
    } finally {
      setReportImporting(false);
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
      useResearch.getState().clear(space.id);
      done();
    }
  };

  useImportFooter({
    label: found?.length ? s.research.importSelected(selected.size) : s.sources.import,
    disabled: !found?.length || !selected.size,
    busy: importing,
    run: importSelected,
  });

  const panel = stage && (
    <Reveal
      data-testid="research-running"
      data-stage={stage}
      className="flex items-center gap-3 rounded-card border border-border px-4 py-3"
      aria-live="polite"
    >
      <ActivityOrb activity={STAGE_ORB[stage]} size={32} />
      <div className="min-w-0">
        <p className="font-medium">
          <TextSwap text={STAGE_LABEL[stage]} />
        </p>
        {detail && <p className="truncate text-label text-muted">{detail}</p>}
      </div>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => useResearch.getState().cancel(space.id)}>
        {s.common.cancel}
      </Button>
    </Reveal>
  );

  return (
    <div className="flex flex-col gap-3.5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim() && !stage) start();
        }}
      >
        <div className="relative flex-1">
          <Input
            value={q}
            onChange={(e) => {
              typed.current = true;
              setQ(e.target.value);
            }}
            placeholder={suggesting ? s.research.suggesting : s.research.placeholder}
            aria-label={s.research.placeholder}
            aria-busy={suggesting}
            className="pr-9"
          />
          <button
            type="button"
            aria-label={s.research.regenerate}
            title={s.research.regenerate}
            disabled={suggesting || !!stage}
            onClick={() => suggest(true)}
            className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-item text-muted hover:bg-fill hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={13} className={suggesting ? "animate-spin" : undefined} />
          </button>
        </div>
        <Button type="submit" variant="secondary" disabled={!q.trim() || !!stage} title={s.research.hint}>
          {s.research.start}
        </Button>
      </form>

      {panel && <Fx fallback={panel} render={() => <ResearchBeam active>{panel}</ResearchBeam>} />}

      {found && found.length === 0 && <EmptyState title={s.research.noResults} />}
      {found && found.length > 0 && (
        <>
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-semibold">{s.research.reviewTitle}</p>
              <p className="text-body leading-[1.5] text-muted">{s.research.reviewBody}</p>
            </div>
            {!report && (
              <Button size="sm" variant="secondary" className="shrink-0" disabled={writing || !selected.size} onClick={makeReport}>
                {writing && <Spinner size={14} />}
                {writing ? s.research.writingReport : s.research.writeReport}
              </Button>
            )}
          </div>
          <ul className="rounded-card border border-border px-3.5" data-testid="research-results">
            {found.map((f, i) => {
              const host = new URL(f.url).hostname.replace(/^www\./, "");
              return (
                <Reveal as="li" index={i} key={f.id} className="group flex h-[42px] items-center gap-2.5 border-divider [&+&]:h-[43px] [&+&]:border-t">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5" title={`${host}\n${f.summary}`}>
                    <Checkbox16
                      checked={selected.has(f.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(f.id);
                        else next.delete(f.id);
                        setSelected(next);
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{f.title}</span>
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
                </Reveal>
              );
            })}
          </ul>
          {report ? (
            <div className="flex flex-col gap-2" data-testid="research-report">
              <p className="font-semibold">{s.research.reportTitle}</p>
              <p className="text-body leading-[1.5] text-muted">{report.cited.length ? s.research.reportBody : s.research.reportUncited}</p>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-card border border-border px-3.5 py-3 text-body leading-[1.5]">{report.markdown}</pre>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={reportImporting} onClick={importReport}>
                  {s.research.importReport}
                </Button>
                <Button size="sm" variant="ghost" disabled={reportImporting} onClick={() => setReport(null)}>
                  {s.research.discardReport}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Credibility({ value }: { value: number }) {
  const level = value >= 75 ? s.research.levels.high : value >= 50 ? s.research.levels.medium : s.research.levels.low;
  return (
    <span title={String(value)} className="shrink-0 text-label text-muted">
      {`${s.research.credibility}: ${level}`}
    </span>
  );
}
