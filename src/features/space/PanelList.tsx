import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function PanelList({ children, inset = 16 }: { children: ReactNode; inset?: 14 | 16 }) {
  return <div className={cn("rounded-card border border-border", inset === 16 ? "px-4" : "px-3.5")}>{children}</div>;
}

export const panelRow = "flex items-center [&+&]:box-content [&+&]:border-t [&+&]:border-divider";
