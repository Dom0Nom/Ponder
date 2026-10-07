import { ChevronsUpDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function NativeSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        {...props}
        className="h-9 w-full appearance-none truncate rounded-control border border-control bg-surface pl-3 pr-8 text-input text-fg transition-colors focus:border-fg focus:outline-none disabled:opacity-60"
      >
        {children}
      </select>
      <ChevronsUpDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}
