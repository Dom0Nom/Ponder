import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

/** In-flow reveal (Transitions.dev Panel reveal): children fade and rise on mount. `index` staggers siblings. */
export function Reveal({
  children,
  className,
  as: Tag = "div",
  index,
  y,
  active = true,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "style"> & {
  as?: ElementType;
  index?: number;
  y?: number;
  /** false renders the element without the enter animation (rows that were already there) */
  active?: boolean;
}) {
  const style = {
    "--panel-translate-y": `${y ?? 12}px`,
    ...(index ? { transitionDelay: `calc(${Math.min(index, 9)} * var(--motion-stagger))` } : {}),
  } as CSSProperties;
  if (!active)
    return (
      <Tag {...rest} className={className}>
        {children}
      </Tag>
    );
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
