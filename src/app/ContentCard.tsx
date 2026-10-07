import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { useUi } from "../stores/ui";

export function ContentCard({ children, className, scroll = true }: { children: ReactNode; className?: string; scroll?: boolean }) {
  const sidebarOpen = useUi((st) => st.sidebarOpen);
  return (
    <div
      className={cn(
        "absolute bottom-[8px] right-[8px] top-0 rounded-pane border border-border bg-surface transition-[left] duration-[180ms] ease-[ease]",
        sidebarOpen ? "left-0" : "left-[8px]",
        scroll ? "overflow-auto" : "overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
