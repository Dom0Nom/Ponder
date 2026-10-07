import { BookOpen, FileText, Globe, SquarePlay, StickyNote, type LucideIcon } from "lucide-react";
import type { SourceKind } from "../../lib/types";

export const KIND_ICON: Record<SourceKind, LucideIcon> = {
  pdf: FileText,
  epub: BookOpen,
  docx: FileText,
  markdown: StickyNote,
  text: StickyNote,
  url: Globe,
  youtube: SquarePlay,
};
