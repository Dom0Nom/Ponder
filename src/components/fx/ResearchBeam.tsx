import type { ReactNode } from "react";
import WorkBeam from "./WorkBeam";

export default function ResearchBeam({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <WorkBeam active={active} size="md" radius={10}>
      {children}
    </WorkBeam>
  );
}
