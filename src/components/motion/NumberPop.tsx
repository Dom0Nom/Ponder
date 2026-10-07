import { useRef } from "react";

export function NumberPop({ text, popKey, className }: { text: string; popKey: string | number; className?: string }) {
  const first = useRef(popKey);
  const animate = first.current !== popKey;
  const chars = [...text];
  return (
    <span className={className} style={{ position: "relative", display: "inline-flex" }}>
      <span className="sr-only">{text}</span>
      <span key={popKey} aria-hidden className={animate ? "t-digit-group is-animating" : "t-digit-group"}>
        {chars.map((ch, i) => (
          <span key={i} className="t-digit" data-stagger={i === chars.length - 2 ? "1" : i === chars.length - 1 ? "2" : undefined}>
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}
