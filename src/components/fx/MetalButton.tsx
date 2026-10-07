import type { ReactNode } from "react";
import { MetalFx } from "metal-fx";
import { useIsDark } from "../../app/useTheme";

export default function MetalButton({ children }: { children: ReactNode }) {
  const dark = useIsDark();
  return (
    <MetalFx
      variant="button"
      preset="silver"
      theme={dark ? "dark" : "light"}
      strength={0.6}
      disableGlow
      ringCssPx={1}
      borderRadius={7}
      className="rounded-[7px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
    >
      {children}
    </MetalFx>
  );
}
