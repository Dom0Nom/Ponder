import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function ChoiceOption({
  label,
  selected,
  state = "idle",
  disabled,
  onClick,
}: {
  label: ReactNode;
  selected: boolean;
  state?: "idle" | "correct" | "wrong";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-tile border px-3.5 py-2.5 text-left text-input font-medium transition-colors",
        state === "correct" && "border-success bg-success-soft",
        state === "wrong" && "border-danger bg-danger-soft",
        state === "idle" && (selected ? "border-fg bg-fill-subtle" : "border-control bg-transparent hover:bg-fill-faint"),
      )}
    >
      <span
        aria-hidden
        className={cn(
          "box-border size-4 shrink-0 rounded-full",
          selected ? "border-[5px] border-fg" : "border-[1.5px] border-faint",
        )}
      />
      <span className="min-w-0 flex-1">{label}</span>
      {state === "correct" && <Check size={16} className="ml-auto text-success" />}
      {state === "wrong" && <X size={16} className="ml-auto text-danger" />}
    </button>
  );
}
