import type { ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { useIsDark } from "../../app/useTheme";

export default function ResearchBeam({ active, children }: { active: boolean; children: ReactNode }) {
  const dark = useIsDark();
  return (
    <BorderBeam size="md" colorVariant="mono" theme={dark ? "dark" : "light"} active={active} duration={2.4} strength={0.7} borderRadius={10}>
      {children}
    </BorderBeam>
  );
}
