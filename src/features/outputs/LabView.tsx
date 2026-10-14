import { useMemo } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { fieldLabel } from "../../components/ui/input";
import { Slider } from "../../components/ui/slider";
import { formatTick, tickStep, ticks } from "../../lib/plot/ticks";
import { currentValues, resetValues, restoreVersion, sampleLab, saveVersion, setValue, type LabData } from "../../lib/studio/lab";
import { s } from "../../lib/strings";

const W = 640;
const H = 300;
const M = { l: 44, r: 12, t: 12, b: 34 };
const STROKE = ["text-primary", "text-fg", "text-muted", "text-danger"];

const decimals = (step: number) => Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));

export function LabView({ data, onChange }: { data: LabData; onChange: (d: LabData) => void }) {
  const values = currentValues(data);
  const plot = useMemo(() => sampleLab(data, values), [data]);
  const sx = (x: number) => M.l + ((x - data.xMin) / (data.xMax - data.xMin)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - plot.yMin) / (plot.yMax - plot.yMin)) * (H - M.t - M.b);
  const xs = tickStep(data.xMin, data.xMax, 6);
  const ys = tickStep(plot.yMin, plot.yMax, 5);
  return (
    <div className="flex flex-col gap-4" data-testid="lab-card">
      {data.description && <p className="text-body text-fg-secondary">{data.description}</p>}
      <div className="flex flex-col gap-2" role="group" aria-label={s.labCards.sliders}>
        {data.params.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={`lab-param-${p.id}`}>
            <span className="w-40 text-body">
              {p.label}
              {p.unit && <span className="text-muted"> ({p.unit})</span>}
            </span>
            <Slider
              value={values[p.id]}
              min={p.min}
              max={p.max}
              step={p.step}
              label={p.label}
              format={(v) => v.toFixed(decimals(p.step))}
              onChange={(v) => onChange(setValue(data, p.id, v))}
            />
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-card border border-border bg-surface" role="img" aria-label={s.labCards.plotLabel(data.curves.map((c) => c.label).join(", "))} data-testid="lab-plot">
        <g className="text-faint" stroke="currentColor" strokeWidth={1}>
          {ticks(plot.yMin, plot.yMax, ys).map((t) => (
            <line key={`gy${t}`} x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} opacity={0.35} />
          ))}
          {ticks(data.xMin, data.xMax, xs).map((t) => (
            <line key={`gx${t}`} y1={M.t} y2={H - M.b} x1={sx(t)} x2={sx(t)} opacity={0.2} />
          ))}
        </g>
        <g className="fill-muted" fontSize={11}>
          {ticks(plot.yMin, plot.yMax, ys).map((t) => (
            <text key={`ty${t}`} x={M.l - 6} y={sy(t) + 4} textAnchor="end">
              {formatTick(t, ys)}
            </text>
          ))}
          {ticks(data.xMin, data.xMax, xs).map((t) => (
            <text key={`tx${t}`} x={sx(t)} y={H - M.b + 15} textAnchor="middle">
              {formatTick(t, xs)}
            </text>
          ))}
          <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle">
            {data.xLabel}
          </text>
          <text x={10} y={M.t + 4} textAnchor="start" fontSize={11}>
            {data.yLabel}
          </text>
        </g>
        {plot.series.map((c, i) => (
          <polyline
            key={c.label}
            className={STROKE[i % STROKE.length]}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            points={c.points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-label text-muted">
        {plot.series.map((c, i) => (
          <span key={c.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-0.5 w-4 bg-current ${STROKE[i % STROKE.length]}`} />
            {c.label}
          </span>
        ))}
      </div>
      {plot.bad.map((l) => (
        <p key={l} className="text-label text-danger" role="alert">
          {s.labCards.badExpression(l)}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => onChange(saveVersion(data))} data-testid="lab-save-version">
          <Save size={13} />
          {s.labCards.saveVersion}
        </Button>
        <Button variant="ghost-muted" size="sm" onClick={() => onChange(resetValues(data))} data-testid="lab-reset">
          <RotateCcw size={13} />
          {s.labCards.reset}
        </Button>
      </div>
      <section className="flex flex-col gap-1">
        <h3 className={fieldLabel}>{s.labCards.versions}</h3>
        {data.versions.length === 0 && <p className="text-body text-muted">{s.labCards.noVersions}</p>}
        <ul role="list" data-testid="lab-versions">
          {data.versions.map((v, i) => (
            <li key={v.at} className="flex items-center gap-2 border-b border-divider py-1.5" data-testid="lab-version">
              <span className="flex-1 text-body">
                {s.labCards.version(data.versions.length - i, new Date(v.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}
                <span className="text-muted"> · {data.params.map((p) => `${p.id}=${v.values[p.id]}`).join(", ")}</span>
              </span>
              <Button variant="ghost-muted" size="sm" onClick={() => onChange(restoreVersion(data, i))}>
                {s.labCards.restore}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
