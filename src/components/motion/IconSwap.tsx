import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

/** Transitions.dev Icon swap for a value with several icons: the old icon blurs out as the new one scales in. */
export function IconSwap({ value, icons, size = 15, className }: { value: string; icons: Record<string, LucideIcon>; size?: number; className?: string }) {
  const [slots, setSlots] = useState<{ a: string; b: string; active: "a" | "b" }>({ a: value, b: value, active: "a" });
  if (slots[slots.active] !== value) {
    const active = slots.active === "a" ? "b" : "a";
    setSlots({ ...slots, [active]: value, active });
  }
  const A = icons[slots.a];
  const B = icons[slots.b];
  return (
    <span className="t-icon-swap" data-state={slots.active}>
      <A size={size} data-icon="a" className={cn("t-icon", className)} />
      <B size={size} data-icon="b" className={cn("t-icon", className)} />
    </span>
  );
}
