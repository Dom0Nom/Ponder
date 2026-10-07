import { Check, Minus } from "lucide-react";
import { useEffect, useRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Checkbox16({
  className,
  indeterminate,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <span className={cn("relative inline-flex size-4 shrink-0", className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer size-4 cursor-pointer appearance-none rounded-[4px] border-[1.5px] border-faint bg-transparent checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary disabled:cursor-default disabled:opacity-60"
        {...props}
      />
      <Check
        size={11}
        strokeWidth={3}
        aria-hidden
        className="pointer-events-none absolute left-[2.5px] top-[2.5px] hidden text-on-primary peer-checked:block peer-indeterminate:hidden"
      />
      <Minus
        size={11}
        strokeWidth={3}
        aria-hidden
        className="pointer-events-none absolute left-[2.5px] top-[2.5px] hidden text-on-primary peer-indeterminate:block"
      />
    </span>
  );
}
