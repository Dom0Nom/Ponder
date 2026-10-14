import type { CSSProperties } from "react";
import { useReducedMotion } from "../../app/useTheme";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Digits roll up once on mount; the final value is always in the text. `cell` is the digit line height in px. */
export function SpinCounter({ value, cell = 28, className }: { value: string | number; cell?: number; className?: string }) {
  const text = String(value);
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{text}</span>;
  let k = 0;
  const idx = [...text].map((ch) => (/\d/.test(ch) ? k++ : -1));
  return (
    <span className={className} style={{ "--reel-cell": `${cell}px` } as CSSProperties}>
      <span className="sr-only">{text}</span>
      <span className="t-reel" aria-hidden>
        {[...text].map((ch, i) =>
          idx[i] < 0 ? (
            <span key={i}>{ch}</span>
          ) : (
            <span key={i} className="t-reel-d">
              <span className="t-reel-col" style={{ "--n": Number(ch), "--k": idx[i] } as CSSProperties}>
                {DIGITS.slice(0, Number(ch) + 1).map((d) => (
                  <span key={d} style={{ height: cell }}>
                    {d}
                  </span>
                ))}
              </span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}
