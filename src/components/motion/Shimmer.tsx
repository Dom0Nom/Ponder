import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Label beside a running AI step: a highlight sweeps across the text. Static in Reduce motion. */
export function Shimmer({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("t-shimmer", className)}>{children}</span>;
}
