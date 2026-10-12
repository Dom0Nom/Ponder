import { AudioLines, ClipboardList, FileText, History, LayoutDashboard, Network, Presentation, ScrollText, Table2, Workflow, type LucideIcon } from "lucide-react";
import type { OutputKind } from "../../lib/studio/kinds";

export const KIND_ICON: Record<OutputKind, LucideIcon> = {
  report: FileText,
  cheatsheet: ScrollText,
  worksheet: ClipboardList,
  timeline: History,
  table: Table2,
  mindmap: Network,
  diagram: Workflow,
  slides: Presentation,
  infographic: LayoutDashboard,
  audio: AudioLines,
};
