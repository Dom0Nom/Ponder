import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Checkbox16 = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function Checkbox16({ className, ...props }, ref) {
    return (
      <span className={cn("t-check relative inline-flex size-4 shrink-0", className)}>
        <input
          ref={ref}
          type="checkbox"
          className="peer size-4 cursor-pointer appearance-none rounded-kbd border-[1.5px] border-faint bg-transparent checked:border-primary checked:bg-primary disabled:cursor-default disabled:opacity-50"
          {...props}
        />
        <svg viewBox="0 0 16 16" aria-hidden className="pointer-events-none absolute inset-0 text-on-primary">
          <path d="M4.5 8.2 7 10.7l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" pathLength={15} />
        </svg>
      </span>
    );
  },
);
