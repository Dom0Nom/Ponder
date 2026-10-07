import { cn } from "../../lib/utils";
import { PonderMark } from "./PonderMark";

/** 20px animated Ponder mark with an optional label; for text generation only. */
export function GeneratingStatus({ label, className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-label font-medium text-fg-secondary", className)}>
      <PonderMark size={20} state="generating" />
      {label}
    </span>
  );
}
