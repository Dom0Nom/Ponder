import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "../../lib/utils";

/** In-flow reveal (Transitions.dev Panel reveal): children fade and rise on mount. `index` staggers siblings. */
export function Reveal({
  children,
  className,
  as: Tag = "div",
  index,
  y,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  as?: ElementType;
  index?: number;
  y?: number;
  [key: string]: unknown;
}) {
  const style = {
    "--panel-translate-y": `${y ?? 6}px`,
    ...(index ? { transitionDelay: `${Math.min(index, 8) * 40}ms` } : {}),
  } as CSSProperties;
  return (
    <Tag {...rest} className={cn("t-panel-slide", className)} data-open="true" style={style}>
      {children}
    </Tag>
  );
}

/** Transitions.dev Accordion: content stays mounted and grows from zero height. */
export function Collapse({ open, children, className, noblur }: { open: boolean; children: ReactNode; className?: string; noblur?: boolean }) {
  return (
    <div className={cn("t-acc", noblur && "t-acc--noblur", className)} data-open={open}>
      <div className="t-acc-panel" inert={!open}>
        <div className="t-acc-panel-inner">{children}</div>
      </div>
    </div>
  );
}
