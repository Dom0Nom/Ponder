import { ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef, useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { Spinner } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import type {
  CheatsheetData,
  DiagramData,
  InfographicData,
  MindmapData,
  ReportData,
  SlidesData,
  TableData,
  TimelineData,
  WorksheetData,
} from "../../lib/studio/kinds";
import { layoutMindmap, wrapText } from "../../lib/studio/mindmapLayout";
import { cn } from "../../lib/utils";
import { Markdown } from "../chat/Markdown";

export function ReportView({ data }: { data: ReportData }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="prose-chat text-body-lg">
        <Markdown
          text={data.markdown}
          knownCitations={data.sources.length}
          renderCite={(ns) => <sup className="text-label text-muted">[{ns.join(", ")}]</sup>}
        />
      </div>
      {data.sources.length > 0 && (
        <section className="flex flex-col gap-1.5 border-t border-divider pt-4">
          <h2 className="text-label font-semibold text-muted">{s.outputs.sources}</h2>
          <ol className="flex flex-col gap-0.5 text-body text-fg-secondary">
            {data.sources.map((t, i) => (
              <li key={i}>
                [{i + 1}] {t}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function CheatsheetView({ data }: { data: CheatsheetData }) {
  return (
    <div className="prose-chat cheatsheet text-body [column-gap:32px] md:columns-2">
      <Markdown text={data.markdown} />
    </div>
  );
}

export function WorksheetView({ data, showKey }: { data: WorksheetData; showKey: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {data.instructions && <p className="text-body-lg text-fg-secondary">{data.instructions}</p>}
      <ol className="flex flex-col gap-5" data-testid="worksheet-questions">
        {data.questions.map((q, i) => (
          <li key={i} className="flex break-inside-avoid flex-col gap-2">
            <p className="text-body-lg">
              <span className="me-1.5 font-semibold">{i + 1}.</span>
              {q.q}
            </p>
            {q.kind === "choice" && q.options && (
              <ul className="ms-5 flex flex-col gap-1 text-body">
                {q.options.map((o, j) => (
                  <li key={j} className="flex items-center gap-2">
                    <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-faint" />
                    {o}
                  </li>
                ))}
              </ul>
            )}
            {q.kind === "short" && <div aria-hidden className="ms-5 flex flex-col gap-6 pt-4"><span className="border-b border-border" /><span className="border-b border-border" /></div>}
          </li>
        ))}
      </ol>
      {showKey && (
        <section className="flex break-before-page flex-col gap-2 border-t border-divider pt-4" data-testid="answer-key">
          <h2 className="text-title font-semibold">{s.outputs.answerKey}</h2>
          <ol className="flex flex-col gap-1 text-body">
            {data.questions.map((q, i) => (
              <li key={i}>
                <span className="me-1.5 font-semibold">{i + 1}.</span>
                {q.answer}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function TimelineView({ data }: { data: TimelineData }) {
  return (
    <ol className="relative ms-2 flex flex-col gap-5 border-s border-border ps-6">
      {data.events.map((e, i) => (
        <li key={i} className="relative flex break-inside-avoid flex-col gap-0.5">
          <span aria-hidden className="absolute -start-[29.5px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-fg" />
          <span className="text-label font-semibold text-muted">{e.date}</span>
          <span className="text-title-sm font-semibold">{e.title}</span>
          {e.detail && <span className="text-body text-fg-secondary">{e.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

export function TableView({ data }: { data: TableData }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-start text-body">
          <thead>
            <tr className="bg-fill-subtle">
              {data.columns.map((c, i) => (
                <th key={i} scope="col" className="border-b border-border px-3 py-2 font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-b border-divider last:border-b-0">
                {r.map((v, j) => (j === 0 ? <th key={j} scope="row" className="px-3 py-2 font-medium">{v}</th> : <td key={j} className="px-3 py-2 text-fg-secondary">{v}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.caption && <p className="text-label text-muted">{data.caption}</p>}
    </div>
  );
}

export const MindmapView = forwardRef<SVGSVGElement, { data: MindmapData }>(function MindmapView({ data }, ref) {
  const { nodes, edges, width, height } = layoutMindmap(data.root);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pad = 8;
  return (
    <div className="overflow-x-auto">
      <svg
        ref={ref}
        role="img"
        aria-label={data.root.label}
        viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}
        width={width + pad * 2}
        height={height + pad * 2}
        className="max-w-none bg-surface font-[family-name:var(--font-ui)]"
      >
        {edges.map((e) => {
          const a = byId.get(e.from)!;
          const b = byId.get(e.to)!;
          const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
          return <path key={e.to} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className="fill-none stroke-border-hover" strokeWidth={1.5} />;
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.depth === 0 ? 9 : 7} className={n.depth === 0 ? "fill-primary" : n.depth === 1 ? "fill-fill stroke-border-hover" : "fill-surface stroke-border"} strokeWidth={1} />
            <text
              x={n.x + n.w / 2}
              y={n.y + n.h / 2}
              dominantBaseline="central"
              textAnchor="middle"
              className={cn(n.depth === 0 ? "fill-on-primary" : "fill-fg", "text-[12px]")}
              fontWeight={n.depth < 2 ? 600 : 400}
            >
              {n.label.length > 30 ? n.label.slice(0, 29) + "…" : n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
});

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  mermaidReady ??= import("mermaid").then((m) => m.default);
  return mermaidReady;
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Renders Mermaid to an SVG string with the current theme's colors. */
export async function renderMermaid(id: string, code: string): Promise<string> {
  const mermaid = await loadMermaid();
  const dark = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: cssVar("--font-ui"),
    themeVariables: {
      darkMode: dark,
      background: cssVar("--surface"),
      primaryColor: cssVar("--fill"),
      primaryTextColor: cssVar("--text"),
      primaryBorderColor: cssVar("--border-hover"),
      lineColor: cssVar("--text-muted"),
      secondaryColor: cssVar("--fill-subtle"),
      tertiaryColor: cssVar("--surface"),
      fontSize: "13px",
    },
  });
  const { svg } = await mermaid.render(id, code);
  return svg;
}

export function DiagramView({ data, editing, onCode, onSvg }: { data: DiagramData; editing: boolean; onCode: (code: string) => void; onSvg: (svg: string | null) => void }) {
  const rawId = useId();
  const id = "m" + rawId.replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const theme = document.documentElement.dataset.theme;

  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = setTimeout(
      () =>
        renderMermaid(id, data.code)
          .then((out) => {
            if (!live) return;
            setSvg(out);
            setError(null);
            onSvg(out);
          })
          .catch((e) => {
            if (!live) return;
            setError(e instanceof Error ? e.message : String(e));
            onSvg(null);
            document.getElementById("d" + id)?.remove();
          })
          .finally(() => live && setBusy(false)),
      editing ? 350 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.code, id, theme]);

  return (
    <div className="flex flex-col gap-3">
      {editing && (
        <label className="flex flex-col gap-1.5 print:hidden">
          <span className="text-label font-semibold text-muted">{s.outputs.codeLabel}</span>
          <Textarea value={data.code} onChange={(e) => onCode(e.target.value)} rows={10} spellCheck={false} className="font-mono text-label" data-testid="diagram-code" />
        </label>
      )}
      {error && (
        <p role="alert" className="rounded-card border border-danger-border bg-danger-soft px-3 py-2 text-body text-danger-text">
          {s.outputs.diagramError}
        </p>
      )}
      {busy && !svg && <Spinner />}
      {svg && <div className={cn("diagram flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full", error && "opacity-40")} data-testid="diagram" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}

export function SlidesView({ data }: { data: SlidesData }) {
  const [i, setI] = useState(0);
  const n = data.slides.length;
  const at = Math.min(i, n - 1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight") setI((x) => Math.min(n - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);
  return (
    <div className="flex flex-col gap-3">
      <div className="slides-screen flex flex-col gap-3 print:hidden">
        <SlideCard slide={data.slides[at]} first={at === 0} />
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon-sm" aria-label={s.outputs.prevSlide} title={s.outputs.prevSlide} disabled={at === 0} onClick={() => setI(at - 1)}>
            <ChevronLeft size={15} />
          </Button>
          <span className="text-label text-muted" data-testid="slide-counter">
            {s.outputs.slideOf(at + 1, n)}
          </span>
          <Button variant="secondary" size="icon-sm" aria-label={s.outputs.nextSlide} title={s.outputs.nextSlide} disabled={at === n - 1} onClick={() => setI(at + 1)}>
            <ChevronRight size={15} />
          </Button>
        </div>
        {data.slides[at].notes && (
          <div className="flex flex-col gap-1">
            <span className="text-label font-semibold text-muted">{s.outputs.notes}</span>
            <p className="text-body text-fg-secondary">{data.slides[at].notes}</p>
          </div>
        )}
      </div>
      <div className="hidden flex-col print:flex">
        {data.slides.map((sl, j) => (
          <div key={j} className="break-after-page">
            <SlideCard slide={sl} first={j === 0} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideCard({ slide, first }: { slide: SlidesData["slides"][number]; first: boolean }) {
  const titleOnly = first && slide.bullets.length === 0;
  return (
    <div className="flex aspect-video w-full flex-col justify-center gap-4 rounded-card border border-border bg-surface px-[6%] py-[5%]" data-testid="slide">
      <h2 className={cn("font-semibold", titleOnly ? "text-page" : "text-title")}>{slide.title}</h2>
      {slide.bullets.length > 0 && (
        <ul className="flex list-disc flex-col gap-2 ps-5 text-body-lg text-fg-secondary">
          {slide.bullets.map((b, k) => (
            <li key={k}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const IG_W = 720;

export const InfographicView = forwardRef<SVGSVGElement, { title: string; data: InfographicData }>(function InfographicView({ title, data }, ref) {
  const pad = 32;
  let y = pad;
  const parts: React.ReactNode[] = [];
  const titleLines = wrapText(title, 34);
  titleLines.forEach((l, k) => {
    parts.push(<text key={`t${k}`} x={pad} y={y + 26 + k * 34} className="fill-fg text-[28px]" fontWeight={700}>{l}</text>);
  });
  y += titleLines.length * 34 + 8;
  const sub = wrapText(data.subtitle, 70);
  sub.forEach((l, k) => parts.push(<text key={`s${k}`} x={pad} y={y + 16 + k * 20} className="fill-muted text-[15px]">{l}</text>));
  y += sub.length * 20 + 24;
  if (data.stats.length) {
    const gap = 12;
    const w = (IG_W - pad * 2 - gap * (data.stats.length - 1)) / data.stats.length;
    data.stats.forEach((st, k) => {
      const x = pad + k * (w + gap);
      const label = wrapText(st.label, Math.floor(w / 7.5));
      parts.push(
        <g key={`st${k}`}>
          <rect x={x} y={y} width={w} height={96} rx={10} className="fill-fill" />
          <text x={x + 16} y={y + 42} className="fill-fg text-[30px]" fontWeight={700}>{st.value.length > 12 ? st.value.slice(0, 11) + "…" : st.value}</text>
          {label.slice(0, 2).map((l, j) => (
            <text key={j} x={x + 16} y={y + 66 + j * 16} className="fill-muted text-[13px]">{l}</text>
          ))}
        </g>,
      );
    });
    y += 96 + 24;
  }
  const cols = data.sections.length > 2 ? 2 : data.sections.length;
  const colW = (IG_W - pad * 2 - 16 * (cols - 1)) / cols;
  for (let r = 0; r < data.sections.length; r += cols) {
    let rowH = 0;
    data.sections.slice(r, r + cols).forEach((se, c) => {
      const x = pad + c * (colW + 16);
      let yy = y + 20;
      const g: React.ReactNode[] = [<text key="h" x={x} y={yy} className="fill-fg text-[17px]" fontWeight={600}>{se.heading}</text>];
      yy += 10;
      se.points.forEach((p, j) => {
        const lines = wrapText(p, Math.floor((colW - 18) / 7.2));
        lines.forEach((l, li) => {
          yy += li === 0 ? 24 : 19;
          g.push(<text key={`${j}.${li}`} x={x + 16} y={yy} className="fill-fg-secondary text-[14px]">{l}</text>);
          if (li === 0) g.push(<circle key={`${j}d`} cx={x + 5} cy={yy - 5} r={3} className="fill-fg" />);
        });
      });
      rowH = Math.max(rowH, yy - y + 8);
      parts.push(<g key={`se${r + c}`}>{g}</g>);
    });
    y += rowH + 16;
  }
  if (data.takeaway) {
    const lines = wrapText(data.takeaway, 76);
    const h = 30 + lines.length * 20;
    parts.push(
      <g key="tk">
        <rect x={pad} y={y} width={IG_W - pad * 2} height={h} rx={10} className="fill-primary" />
        {lines.map((l, k) => (
          <text key={k} x={pad + 18} y={y + 26 + k * 20} className="fill-on-primary text-[15px]" fontWeight={600}>{l}</text>
        ))}
      </g>,
    );
    y += h;
  }
  const height = y + pad;
  return (
    <div className="overflow-x-auto">
      <svg ref={ref} role="img" aria-label={title} viewBox={`0 0 ${IG_W} ${height}`} width={IG_W} height={height} className="max-w-full rounded-card border border-border bg-surface font-[family-name:var(--font-ui)]" data-testid="infographic">
        {parts}
      </svg>
    </div>
  );
});
