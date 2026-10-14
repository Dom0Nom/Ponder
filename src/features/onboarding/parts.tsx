import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Heading({ title, body, center }: { title: string; body?: string; center?: boolean }) {
  return (
    <div className={cn("t-stagger is-shown flex flex-col gap-2", center && "items-center text-center")}>
      <h1 tabIndex={-1} className="t-stagger-line text-page font-semibold outline-none">
        {title}
      </h1>
      {body && <p className="t-stagger-line t-stagger-line--2 max-w-[520px] text-pretty text-body-lg leading-[1.5] text-muted">{body}</p>}
    </div>
  );
}

/** Radio-style choice card; the selected one gets a gray fill, never a solid one. */
export function Choice({
  selected,
  onSelect,
  title,
  body,
  badge,
  index = 0,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body?: string;
  badge?: string;
  index?: number;
  children?: ReactNode;
}) {
  return (
    <div
      className="t-panel-slide"
      data-open="true"
      style={{ "--panel-translate-y": "20px", transitionDelay: `${Math.min(index, 8) * 60}ms` } as React.CSSProperties}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col items-start gap-1 rounded-card border p-4 text-start transition-colors",
          selected ? "border-fg bg-fill" : "border-border hover:bg-fill-faint",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <span className="text-input font-semibold">{title}</span>
          {badge && <span className="rounded-full bg-fill-active px-2 py-0.5 text-label font-medium text-fg-secondary">{badge}</span>}
        </span>
        {body && <span className="text-body text-muted">{body}</span>}
      </button>
      {children}
    </div>
  );
}

export const sectionTitle = "text-label font-semibold text-muted";
