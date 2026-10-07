import { cn } from "../../lib/utils";
import { ThinkingLine } from "../motion/ThinkingLine";
import { PonderMark } from "./PonderMark";

/** 20px animated Ponder mark with an optional label; for text generation only. `think` adds the shimmering, swapping label. */
export function GeneratingStatus({ label, think, className }: { label?: string; think?: boolean; className?: string }) {
  return (
    <span role={think ? undefined : "status"} className={cn("inline-flex items-center gap-2 text-label font-medium text-fg-secondary", className)}>
      <PonderMark size={20} state="generating" />
      {think && label ? <ThinkingLine label={label} /> : label}
    </span>
  );
}
