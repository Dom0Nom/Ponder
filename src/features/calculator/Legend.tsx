import type { ReactNode } from "react";

/** Key legends drawn in SVG so baselines land where UI-SPEC §4.4 measures them. */

const SERIF = "Georgia, 'Times New Roman', serif";

type Seg = { t: "text" | "sup" | "special"; v: string };

function segments(s: string): Seg[] {
  const out: Seg[] = [];
  const re = /\{([^}]*)\}/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    const v = m[1];
    out.push({ t: ["nd", "Und", "pi", "var", "toggle", "caret"].includes(v) ? "special" : "sup", v });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

function TextLine({ segs, x, y, size }: { segs: Seg[]; x: number; y: number; size: number }) {
  return (
    <text x={x} y={y} fontSize={size} textAnchor="middle" fontWeight={600} style={{ fontFamily: "var(--font-ui)" }}>
      {segs.map((sg, i) =>
        sg.t === "sup" ? (
          <tspan key={i} fontSize={size * 0.62} dy={-size * 0.42}>
            {sg.v.replace("-", "−")}
          </tspan>
        ) : (
          <tspan key={i} dy={i > 0 && segs[i - 1].t === "sup" ? size * 0.42 : 0}>
            {sg.v}
          </tspan>
        ),
      )}
    </text>
  );
}

function StackedND({ x, top, size }: { x: number; top: number; size: number }) {
  const bar = top + size * 0.95;
  return (
    <g style={{ fontFamily: "var(--font-ui)" }} fontWeight={600} fontSize={size}>
      <text x={x} y={top + size * 0.8} textAnchor="middle">
        n
      </text>
      <rect x={x - size * 0.45} y={bar} width={size * 0.9} height={Math.max(1, size * 0.1)} />
      <text x={x} y={bar + size * 0.95} textAnchor="middle">
        d
      </text>
    </g>
  );
}

const OPS: Record<string, (cx: number, cy: number) => ReactNode> = {
  "÷": (cx, cy) => (
    <>
      <rect x={cx - 6.5} y={cy - 1} width={13} height={2} />
      <circle cx={cx} cy={cy - 4.5} r={1.4} />
      <circle cx={cx} cy={cy + 4.5} r={1.4} />
    </>
  ),
  "×": (cx, cy) => (
    <g strokeWidth={2} stroke="currentColor">
      <line x1={cx - 5} y1={cy - 5} x2={cx + 5} y2={cy + 5} />
      <line x1={cx + 5} y1={cy - 5} x2={cx - 5} y2={cy + 5} />
    </g>
  ),
  "−": (cx, cy) => <rect x={cx - 6.5} y={cy - 1} width={13} height={2} />,
  "+": (cx, cy) => (
    <>
      <rect x={cx - 6.5} y={cy - 1} width={13} height={2} />
      <rect x={cx - 1} y={cy - 6.5} width={2} height={13} />
    </>
  ),
};

/** Main legend centred on the key, baseline ≈ +28. */
export function MainLegend({ text, w, h }: { text: string; w: number; h: number }) {
  const cx = w / 2;
  if (OPS[text]) {
    return (
      <g>
        {OPS[text](cx, h / 2 + 2)}
      </g>
    );
  }
  switch (text) {
    case "{nd}":
      return <StackedND x={cx} top={13} size={10} />;
    case "{pi}":
      return (
        <text x={cx} y={28} fontSize={19} textAnchor="middle" fontStyle="italic" style={{ fontFamily: SERIF }}>
          π
        </text>
      );
    case "{var}":
      return (
        <g fontStyle="italic" style={{ fontFamily: SERIF }}>
          <text x={cx - 7} y={29} fontSize={20} textAnchor="middle">
            x
          </text>
          <text x={cx + 7} y={18} fontSize={8.5} textAnchor="middle">
            yzt
          </text>
          <text x={cx + 7} y={29} fontSize={8.5} textAnchor="middle">
            abc
          </text>
        </g>
      );
    case "{toggle}": {
      const cy = h / 2;
      return (
        <g>
          <polygon points={`${cx - 7.5},${cy} ${cx - 1},${cy - 4.5} ${cx - 1},${cy + 4.5}`} />
          <polygon points={`${cx + 7.5},${cy} ${cx + 1},${cy - 4.5} ${cx + 1},${cy + 4.5}`} />
        </g>
      );
    }
    case "{caret}":
      return <polyline points={`${cx - 6},${27} ${cx},${18} ${cx + 6},${27}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="miter" />;
    case "(−)":
      return (
        <text x={cx} y={28} fontSize={14} textAnchor="middle" fontWeight={600} style={{ fontFamily: "var(--font-ui)" }}>
          <tspan>(</tspan>
          <tspan fontSize={10} dy={-3}>
            −
          </tspan>
          <tspan dy={3}>)</tspan>
        </text>
      );
  }
  const digit = /^[0-9.]$/.test(text);
  const size = digit ? 20 : text === "enter" ? 12 : 13;
  const y = digit ? 28 : text === "enter" ? 26 : 28;
  return <TextLine segs={segments(text)} x={cx} y={y} size={size} />;
}

/** 2nd-function legend inside the key at the top (ink top ≈ +5). */
export function SecondLegend({ text, w }: { text: string; w: number }) {
  const cx = w / 2;
  if (text === "{Und}") {
    return (
      <g>
        <text x={cx - 4} y={12} fontSize={9} textAnchor="middle" fontWeight={600} style={{ fontFamily: "var(--font-ui)" }}>
          U
        </text>
        <StackedND x={cx + 4} top={3} size={5.5} />
      </g>
    );
  }
  const plain = text.replace(/\{nd\}/g, "n/d").replace(/\{Und\}/g, "Un/d");
  const size = plain.length > 7 ? 7.5 : 9;
  return <TextLine segs={segments(plain)} x={cx} y={12} size={size} />;
}
