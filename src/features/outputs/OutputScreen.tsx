import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Download, Printer, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { renderSegments } from "../../lib/tts/player";
import { useSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import {
  audioMarkdown,
  mindmapMarkdown,
  slidesMarkdown,
  standaloneSvg,
  svgToPng,
  timelineMarkdown,
  toCsv,
  toPptx,
  toXlsx,
  utf8,
  worksheetMarkdown,
} from "../../lib/studio/export";
import type { OutputDataMap } from "../../lib/studio/kinds";
import type { StudioOutput } from "../../lib/types";
import { qkOutput, qkOutputs, useOutputJobs } from "../../stores/outputJobs";
import { useUi } from "../../stores/ui";
import { AudioView } from "./AudioView";
import { currentExplainerDoc, ExplainerView } from "./ExplainerView";
import { KIND_ICON } from "./kindIcons";
import { CheatsheetView, DiagramView, InfographicView, MindmapView, ReportView, SlidesView, TableView, TimelineView, WorksheetView } from "./Renderers";

type Format = keyof typeof s.outputs.formats;

const FORMATS: Record<StudioOutput["kind"], Format[]> = {
  report: ["md"],
  cheatsheet: ["md"],
  worksheet: ["md"],
  timeline: ["md", "csv"],
  table: ["xlsx", "csv"],
  mindmap: ["svg", "png", "md"],
  diagram: ["svg", "png", "mmd"],
  slides: ["pptx", "md"],
  infographic: ["png", "svg"],
  audio: ["mp3", "md"],
  explainer: ["html"],
};

const svgSize = (svg: string) => {
  const m = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 800, h: 600 };
};

export function OutputScreen({ spaceId, outputId }: { spaceId: string; outputId: string }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const setStudioView = useUi((st) => st.setStudioView);
  const space = useSpace(spaceId);
  const q = useQuery({ queryKey: qkOutput(outputId), queryFn: () => api.outputGet(outputId) });
  const job = useOutputJobs((st) => st.jobs[spaceId]);
  const jobError = useOutputJobs((st) => st.errors[spaceId]);
  const [draft, setDraft] = useState<StudioOutput | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [printKey, setPrintKey] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const diagramSvg = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef<StudioOutput | null>(null);

  const save = (next: StudioOutput) =>
    api
      .outputSave(next)
      .then((saved) => {
        if (unsaved.current === next) {
          unsaved.current = null;
          qc.setQueryData(qkOutput(saved.id), saved);
        }
        void qc.invalidateQueries({ queryKey: qkOutputs(spaceId) });
      })
      .catch((e) => toastError(s.errors.generic, e));

  useEffect(() => {
    if (!unsaved.current) setDraft(q.data ?? null);
  }, [q.data]);
  useEffect(
    () => () => {
      if (saveTimer.current && unsaved.current) {
        clearTimeout(saveTimer.current);
        void save(unsaved.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const back = () => {
    navigate({ name: "space", spaceId });
    setStudioView("create");
  };

  if (q.isLoading || space.isLoading) return <Shell><Skeleton className="h-96 rounded-card" /></Shell>;
  if (q.error) return <Shell><ErrorState title={s.outputs.loadFailed} error={q.error} onRetry={() => q.refetch()} /></Shell>;
  if (!q.data || !draft) return <Shell><ErrorState title={s.outputs.notFound} error={null} onRetry={back} /></Shell>;
  const out = draft;
  const Icon = KIND_ICON[out.kind];

  const persist = (next: StudioOutput) => {
    setDraft(next);
    unsaved.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save(next);
    }, 600);
  };

  const bytesFor = async (f: Format): Promise<Uint8Array> => {
    const d = out.data;
    switch (f) {
      case "md":
        if (out.kind === "report" || out.kind === "cheatsheet") {
          const r = d as OutputDataMap["report"];
          const refs = out.kind === "report" && r.sources.length ? `\n\n## ${s.outputs.sources}\n\n${r.sources.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : "";
          return utf8(`# ${out.title}\n\n${r.markdown}${refs}\n`);
        }
        if (out.kind === "worksheet") return utf8(worksheetMarkdown(out.title, d as OutputDataMap["worksheet"], true));
        if (out.kind === "timeline") return utf8(timelineMarkdown(out.title, d as OutputDataMap["timeline"]));
        if (out.kind === "mindmap") return utf8(mindmapMarkdown((d as OutputDataMap["mindmap"]).root));
        if (out.kind === "audio") return utf8(audioMarkdown(out.title, d as OutputDataMap["audio"]));
        return utf8(slidesMarkdown(out.title, (d as OutputDataMap["slides"]).slides));
      case "csv":
        if (out.kind === "timeline") {
          const t = d as OutputDataMap["timeline"];
          return utf8(toCsv(["Date", "Event", "Detail"], t.events.map((e) => [e.date, e.title, e.detail])));
        }
        return utf8(toCsv((d as OutputDataMap["table"]).columns, (d as OutputDataMap["table"]).rows));
      case "xlsx":
        return toXlsx(d as OutputDataMap["table"], out.title);
      case "pptx":
        return toPptx(out.title, (d as OutputDataMap["slides"]).slides);
      case "mmd":
        return utf8((d as OutputDataMap["diagram"]).code + "\n");
      case "svg":
      case "png": {
        const svg = out.kind === "diagram" ? diagramSvg.current : svgRef.current ? standaloneSvg(svgRef.current) : null;
        if (!svg) throw new Error(s.outputs.diagramError);
        if (f === "svg") return utf8(svg);
        const { w, h } = svgSize(svg);
        return svgToPng(svg, w, h);
      }
      case "html":
        return utf8(currentExplainerDoc((d as OutputDataMap["explainer"]).html, out.title));
      case "mp3": {
        const lines = (d as OutputDataMap["audio"]).lines;
        const t = toast.loading(s.outputs.audio.recording(0, lines.length));
        try {
          return await renderSegments(
            lines.map((l) => ({ text: l.text, voice: l.host })),
            (done, total) => toast.loading(s.outputs.audio.recording(done, total), { id: t }),
          );
        } catch (e) {
          throw e instanceof Error && e.message === "mp3" ? new Error(s.outputs.audio.mp3Unsupported) : e;
        } finally {
          toast.dismiss(t);
        }
      }
    }
  };

  const exportAs = async (f: Format) => {
    try {
      const path = await api.exportFile(out.title, f, await bytesFor(f));
      if (path) toast.success(s.outputs.exported(path));
    } catch (e) {
      toastError(s.outputs.exportFailed, e);
    }
  };

  const print = async () => {
    try {
      await api.printWindow();
    } catch (e) {
      toastError(s.outputs.printFailed, e);
    }
  };

  const remake = () => {
    if (space.data) void useOutputJobs.getState().start(space.data, out.kind, out.focus ?? "", out.id, out.kind === "audio" ? (out.data as OutputDataMap["audio"]).style : undefined);
  };

  const remove = async () => {
    try {
      await api.outputDelete(out.id);
      qc.removeQueries({ queryKey: qkOutput(out.id) });
      await qc.invalidateQueries({ queryKey: qkOutputs(spaceId) });
      back();
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };

  const body = (() => {
    switch (out.kind) {
      case "report":
        return <ReportView data={out.data as OutputDataMap["report"]} />;
      case "cheatsheet":
        return <CheatsheetView data={out.data as OutputDataMap["cheatsheet"]} />;
      case "worksheet":
        return <WorksheetView data={out.data as OutputDataMap["worksheet"]} showKey={showKey} />;
      case "timeline":
        return <TimelineView data={out.data as OutputDataMap["timeline"]} />;
      case "table":
        return <TableView data={out.data as OutputDataMap["table"]} />;
      case "mindmap":
        return <MindmapView ref={svgRef} data={out.data as OutputDataMap["mindmap"]} />;
      case "diagram":
        return (
          <DiagramView
            data={out.data as OutputDataMap["diagram"]}
            editing={editing}
            onCode={(code) => persist({ ...out, data: { code } })}
            onSvg={(svg) => (diagramSvg.current = svg)}
          />
        );
      case "slides":
        return <SlidesView data={out.data as OutputDataMap["slides"]} />;
      case "infographic":
        return <InfographicView ref={svgRef} title={out.title} data={out.data as OutputDataMap["infographic"]} />;
      case "explainer":
        return <ExplainerView data={out.data as OutputDataMap["explainer"]} />;
      case "audio":
        return <AudioView id={out.id} title={out.title} data={out.data as OutputDataMap["audio"]} space={space.data} />;
    }
  })();

  return (
    <Shell wide={out.kind === "table" || out.kind === "mindmap" || out.kind === "diagram"}>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost-muted" size="sm" onClick={back} className="-ml-2">
          <ArrowLeft size={14} />
          {space.data ? s.common.backTo(space.data.name) : s.outputs.back}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {out.kind === "diagram" && (
            <Button variant="secondary" size="sm" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
              {editing ? s.outputs.doneEditing : s.outputs.editCode}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={remake} disabled={!!job || !space.data}>
            <RefreshCw size={13} className={job ? "animate-spin" : undefined} />
            {s.outputs.remake}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm" data-testid="output-export">
                <Download size={13} />
                {s.outputs.export}
                <ChevronDown size={13} className="text-muted" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              {FORMATS[out.kind].map((f) => (
                <MenuItem key={f} onSelect={() => void exportAs(f)}>
                  {s.outputs.formats[f]}
                </MenuItem>
              ))}
              <MenuItem onSelect={() => void print()}>
                <Printer size={14} />
                {s.outputs.print}
              </MenuItem>
            </MenuContent>
          </Menu>
          <Button variant="ghost-muted" size="icon-sm" title={s.outputs.delete} aria-label={s.outputs.delete} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {jobError != null && !job && <ErrorState size="sm" title={s.outputs.failed} error={jobError} onRetry={remake} />}
      <article className="print-root flex flex-col gap-5" data-testid="output" data-kind={out.kind}>
        <header className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-label font-semibold text-muted print:hidden">
            <Icon size={13} />
            {s.outputs.kinds[out.kind].name}
            {out.focus && <span className="font-normal">· {s.outputs.madeFrom(out.focus)}</span>}
          </span>
          <h1 className="text-page font-semibold">{out.title}</h1>
        </header>
        {out.kind === "worksheet" && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
            <Button variant="secondary" size="sm" onClick={() => setShowKey((k) => !k)} data-testid="toggle-key">
              {showKey ? s.outputs.hideKey : s.outputs.showKey}
            </Button>
            <span className="flex items-center gap-2 text-body text-fg-secondary">
              <Switch checked={printKey} onCheckedChange={setPrintKey} label={s.outputs.printKey} />
              {s.outputs.printKey}
            </span>
          </div>
        )}
        {body}
        {out.kind === "worksheet" && printKey && !showKey && (
          <div className="hidden print:block">
            <WorksheetKeyOnly data={out.data as OutputDataMap["worksheet"]} />
          </div>
        )}
      </article>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={s.outputs.deleteTitle} body={s.outputs.deleteBody} confirmLabel={s.outputs.delete} danger onConfirm={() => void remove()} />
    </Shell>
  );
}

function WorksheetKeyOnly({ data }: { data: OutputDataMap["worksheet"] }) {
  return (
    <section className="flex break-before-page flex-col gap-2 pt-4">
      <h2 className="text-title font-semibold">{s.outputs.answerKey}</h2>
      <ol className="flex flex-col gap-1 text-body">
        {data.questions.map((q, i) => (
          <li key={i}>
            <span className="mr-1.5 font-semibold">{i + 1}.</span>
            {q.answer}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex h-full overflow-y-auto print:block print:h-auto print:overflow-visible">
      <div className={`mx-auto flex w-full flex-col gap-5 px-10 pb-12 pt-8 ${wide ? "max-w-[1100px]" : "max-w-[800px]"}`} data-testid="output-screen">
        {children}
      </div>
    </div>
  );
}
