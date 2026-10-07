import { cn } from "../../lib/utils";
import { useIsDark } from "../../app/useTheme";
import markDark from "../../assets/brand/ponder-mark-dark.png";
import markLight from "../../assets/brand/ponder-mark-light.png";

export type PonderMarkState = "static" | "idle" | "generating";

const ASPECT = 211 / 274;

export function PonderMark({
  size,
  state = "static",
  className,
}: {
  size: number;
  /** "idle" and "generating" get the liquid-metal shader later; for now every state shows the static mark */
  state?: PonderMarkState;
  className?: string;
}) {
  const dark = useIsDark();
  return (
    <img
      src={dark ? markDark : markLight}
      alt=""
      aria-hidden
      draggable={false}
      data-state={state}
      width={Math.round(size * ASPECT)}
      height={size}
      style={{ height: size, width: "auto" }}
      className={cn("select-none", className)}
    />
  );
}
