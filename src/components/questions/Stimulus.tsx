import { useRef } from "react";
import { layoutChart } from "../../lib/plot/charts";
import { formatTick, tickStep, ticks } from "../../lib/plot/ticks";
import type { ChartSpec, Region, Stimulus as StimulusData } from "../../lib/questions/types";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { Markdown } from "../../features/chat/Markdown";

export interface Pick {
  x?: number;
  y?: number;
  row?: number;
  col?: number;
}

const W = 420;
const H = 240;
const OPACITY = [1, 0.55, 0.3, 0.8];

function toLocal(e: React.MouseEvent<SVGSVGElement>): [number, number] {
  const r = e.currentTarget.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
}

function Axes({ l, labels }: { l: ReturnType<typeof layoutChart>; labels: { x?: string; y?: string } }) {
  return (
    <g fontSize="10" fill="var(--text-muted)">
      {l.yTicks.map((t) => (
        <g key={t.v}>
          <line x1={l.plot.x} x2={l.plot.x + l.plot.w} y1={t.y} y2={t.y} stroke="var(--divider)" />
          <text x={l.plot.x - 6} y={t.y + 3} textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}
      {l.xTicks.map((t, i) => (
        <text key={i} x={t.x} y={l.plot.y + l.plot.h + 14} textAnchor="middle">
          {t.label}
        </text>
      ))}
      <line x1={l.plot.x} x2={l.plot.x} y1={l.plot.y} y2={l.plot.y + l.plot.h} stroke="var(--border-hover)" />
      <line x1={l.plot.x} x2={l.plot.x + l.plot.w} y1={l.plot.y + l.plot.h} y2={l.plot.y + l.plot.h} stroke="var(--border-hover)" />
      {labels.x && (
        <text x={l.plot.x + l.plot.w / 2} y={H - 4} textAnchor="middle">
          {labels.x}
        </text>
      )}
      {labels.y && (
        <text transform={`translate(10 ${l.plot.y + l.plot.h / 2}) rotate(-90)`} textAnchor="middle">
          {labels.y}
        </text>
      )}
    </g>
  );
}

function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 text-label text-muted" role="list">
      {names.map((n, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-kbd" style={{ background: "var(--primary)", opacity: OPACITY[i % 4] }} />
          {n}
        </li>
      ))}
    </ul>
  );
}

export function ChartView({ chart, onPick, picked, reveal }: { chart: ChartSpec; onPick?: (p: Pick) => void; picked?: Pick | null; reveal?: Region | null }) {
  const l = layoutChart(chart, W, H);
  const desc = chart.series.map((x) => x.name).join(", ");
  const px = picked?.x != null && picked.y != null ? l.toPx(picked.x, picked.y) : null;
  return (
    <figure className="flex flex-col gap-1.5" data-testid="stimulus-chart">
      {chart.title && <figcaption className="text-label font-semibold text-fg-secondary">{chart.title}</figcaption>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${chart.title ?? chart.type}: ${desc}`}
        className={cn("w-full max-w-[480px]", onPick && "cursor-crosshair")}
        onClick={onPick ? (e) => ((p) => onPick({ x: l.fromPx(p[0], p[1])[0], y: l.fromPx(p[0], p[1])[1] }))(toLocal(e)) : undefined}
      >
        <Axes l={l} labels={{ x: chart.xLabel, y: chart.yLabel }} />
        {l.marks.map((m, i) =>
          m.w != null ? (
            <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} fill="var(--primary)" opacity={OPACITY[m.series % 4]}>
              <title>{m.label}</title>
            </rect>
          ) : null,
        )}
        {l.lines.map((ln) => (
          <polyline key={ln.series} points={ln.points.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2" opacity={OPACITY[ln.series % 4]} />
        ))}
        {l.marks.map((m, i) =>
          m.w == null ? (
            <circle key={i} cx={m.x} cy={m.y} r={chart.type === "scatter" ? 3.5 : 3} fill="var(--primary)" opacity={OPACITY[m.series % 4]}>
              <title>{m.label}</title>
            </circle>
          ) : null,
        )}
        {reveal && reveal.shape !== "cell" && (() => {
          const [cx, cy] = l.toPx(reveal.x, reveal.y);
          return <circle className="m-hotspot-reveal" cx={cx} cy={cy} r="10" fill="none" stroke="var(--success)" strokeWidth="2" />;
        })()}
        {px && <circle className="m-hotspot-pin" cx={px[0]} cy={px[1]} r="5" fill="var(--text)" stroke="var(--surface)" strokeWidth="2" />}
      </svg>
      <Legend names={l.series} />
    </figure>
  );
}

export function PlaneView({
  data,
  onPick,
  picked,
  reveal,
}: {
  data: Extract<StimulusData, { type: "plane" }>;
  onPick?: (p: Pick) => void;
  picked?: Pick | null;
  reveal?: Region | null;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const size = 260;
  const m = 22;
  const sx = (x: number) => m + ((x - data.xMin) / (data.xMax - data.xMin)) * (size - 2 * m);
  const sy = (y: number) => size - m - ((y - data.yMin) / (data.yMax - data.yMin)) * (size - 2 * m);
  const xs = tickStep(data.xMin, data.xMax, 10);
  const ys = tickStep(data.yMin, data.yMax, 10);
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * size;
    const py = ((e.clientY - r.top) / r.height) * size;
    onPick?.({
      x: Math.round((data.xMin + ((px - m) / (size - 2 * m)) * (data.xMax - data.xMin)) * 10) / 10,
      y: Math.round((data.yMin + ((size - m - py) / (size - 2 * m)) * (data.yMax - data.yMin)) * 10) / 10,
    });
  };
  const unit = (size - 2 * m) / (data.xMax - data.xMin);
  return (
    <figure className="flex flex-col gap-1.5" data-testid="stimulus-plane">
      <svg
        ref={ref}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={s.questions.plane}
        className={cn("w-full max-w-[300px]", onPick && "cursor-crosshair")}
        onClick={onPick ? click : undefined}
      >
        <g fontSize="9" fill="var(--text-muted)">
          {ticks(data.xMin, data.xMax, xs).map((v) => (
            <g key={`x${v}`}>
              <line x1={sx(v)} x2={sx(v)} y1={sy(data.yMin)} y2={sy(data.yMax)} stroke="var(--divider)" />
              <text x={sx(v)} y={size - 8} textAnchor="middle">
                {formatTick(v, xs)}
              </text>
            </g>
          ))}
          {ticks(data.yMin, data.yMax, ys).map((v) => (
            <g key={`y${v}`}>
              <line x1={sx(data.xMin)} x2={sx(data.xMax)} y1={sy(v)} y2={sy(v)} stroke="var(--divider)" />
              <text x={m - 4} y={sy(v) + 3} textAnchor="end">
                {formatTick(v, ys)}
              </text>
            </g>
          ))}
        </g>
        {data.xMin <= 0 && data.xMax >= 0 && <line x1={sx(0)} x2={sx(0)} y1={sy(data.yMin)} y2={sy(data.yMax)} stroke="var(--border-hover)" strokeWidth="1.5" />}
        {data.yMin <= 0 && data.yMax >= 0 && <line x1={sx(data.xMin)} x2={sx(data.xMax)} y1={sy(0)} y2={sy(0)} stroke="var(--border-hover)" strokeWidth="1.5" />}
        {(data.lines ?? []).map((ln, i) => (
          <line key={i} x1={sx(data.xMin)} y1={sy(ln.m * data.xMin + ln.b)} x2={sx(data.xMax)} y2={sy(ln.m * data.xMax + ln.b)} stroke="var(--primary)" strokeWidth="2" />
        ))}
        {(data.points ?? []).map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r="3.5" fill="var(--primary)" />
            {p.label && (
              <text x={sx(p.x) + 6} y={sy(p.y) - 5} fontSize="10" fill="var(--text)">
                {p.label}
              </text>
            )}
          </g>
        ))}
        {reveal?.shape === "circle" && <circle className="m-hotspot-reveal" cx={sx(reveal.x)} cy={sy(reveal.y)} r={Math.max(8, reveal.r * unit)} fill="none" stroke="var(--success)" strokeWidth="2" />}
        {reveal?.shape === "rect" && <rect className="m-hotspot-reveal" x={sx(reveal.x)} y={sy(reveal.y + reveal.h)} width={reveal.w * unit} height={reveal.h * unit} fill="none" stroke="var(--success)" strokeWidth="2" />}
        {picked?.x != null && picked.y != null && <circle className="m-hotspot-pin" cx={sx(picked.x)} cy={sy(picked.y)} r="5" fill="var(--text)" stroke="var(--surface)" strokeWidth="2" />}
      </svg>
    </figure>
  );
}

export function TableView({
  data,
  onPick,
  picked,
  reveal,
}: {
  data: Extract<StimulusData, { type: "table" }>;
  onPick?: (p: Pick) => void;
  picked?: Pick | null;
  reveal?: Region | null;
}) {
  return (
    <div className="overflow-x-auto" data-testid="stimulus-table">
      {data.title && <p className="pb-1 text-label font-semibold text-fg-secondary">{data.title}</p>}
      <table className="border-collapse text-body">
        <thead>
          <tr>
            {data.columns.map((c, i) => (
              <th key={i} className="border border-border bg-fill-subtle px-2.5 py-1.5 text-start font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => {
                const isPicked = picked?.row === ri && picked.col === ci;
                const isKey = reveal?.shape === "cell" && reveal.row === ri && reveal.col === ci;
                return (
                  <td
                    key={ci}
                    className={cn("border border-border px-2.5 py-1.5", onPick && "p-0", isKey && "bg-success-soft", isPicked && !isKey && "bg-fill")}
                  >
                    {onPick ? (
                      <button
                        type="button"
                        data-cell={`${ri}-${ci}`}
                        aria-pressed={isPicked}
                        onClick={() => onPick({ row: ri, col: ci })}
                        className="m-hotspot-cell block w-full px-2.5 py-1.5 text-start hover:bg-fill-faint"
                      >
                        {c}
                      </button>
                    ) : (
                      c
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stimulus({
  data,
  onPick,
  picked,
  reveal,
}: {
  data: StimulusData;
  onPick?: (p: Pick) => void;
  picked?: Pick | null;
  reveal?: Region | null;
}) {
  if (data.type === "passage") {
    return (
      <blockquote className="rounded-card border border-border bg-fill-faint px-3.5 py-3" data-testid="stimulus-passage">
        {data.title && <p className="pb-1 font-semibold">{data.title}</p>}
        <Markdown text={data.text} />
      </blockquote>
    );
  }
  if (data.type === "table") return <TableView data={data} onPick={onPick} picked={picked} reveal={reveal} />;
  if (data.type === "chart") return <ChartView chart={data.chart} onPick={onPick} picked={picked} reveal={reveal} />;
  return <PlaneView data={data} onPick={onPick} picked={picked} reveal={reveal} />;
}
