import { useRef, useState, type ReactNode } from "react";

const BAND = 44;

/** Dims everything except a band under the pointer. Children are passed through untouched so pointer moves don't re-render them. */
export function ReadingRuler({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState<number | null>(null);
  const show = enabled && y !== null;
  const top = Math.max(0, (y ?? 0) - BAND / 2);

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1"
      onPointerMove={(e) => {
        if (!enabled) return;
        setY(e.clientY - (ref.current?.getBoundingClientRect().top ?? 0));
      }}
      onPointerLeave={() => setY(null)}
    >
      {children}
      {show && (
        <div aria-hidden data-testid="reading-ruler" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 bg-bg/60 motion-safe:transition-[height] motion-safe:duration-75" style={{ height: top }} />
          <div className="absolute inset-x-0 bottom-0 bg-bg/60 motion-safe:transition-[top] motion-safe:duration-75" style={{ top: top + BAND }} />
          <div className="absolute inset-x-0 border-y border-accent/30" style={{ top, height: BAND }} />
        </div>
      )}
    </div>
  );
}
