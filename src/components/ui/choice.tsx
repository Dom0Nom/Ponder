import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SuccessCheck } from "../motion/SuccessCheck";
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
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (state === "wrong") setShaking(true);
  }, [state]);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      onAnimationEnd={() => setShaking(false)}
      className={cn(
        "t-input flex min-h-11 w-full items-center gap-3 rounded-tile border px-3.5 py-2.5 text-start text-input font-medium transition-colors",
        shaking && "is-shaking",
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
      {state === "correct" && (
        <span className="ms-auto text-success">
          <SuccessCheck size={16} />
        </span>
      )}
      {state === "wrong" && <X size={16} className="ms-auto text-danger" />}
    </button>
  );
}
