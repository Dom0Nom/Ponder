import {
  Atom, BookOpen, Bot, Brain, Calculator, Code, Cpu, FlaskConical, Globe, GraduationCap, Languages, Music, Palette, Landmark, Leaf, type LucideIcon,
} from "lucide-react";
import { cn } from "./utils";

export const SPACE_ICONS: Record<string, LucideIcon> = {
  calculator: Calculator,
  languages: Languages,
  leaf: Leaf,
  code: Code,
  bot: Bot,
  landmark: Landmark,
  flask: FlaskConical,
  book: BookOpen,
  music: Music,
  globe: Globe,
  cpu: Cpu,
  atom: Atom,
  palette: Palette,
  brain: Brain,
  graduation: GraduationCap,
};

export function SpaceIcon({ icon, size = 17, tile = true, className }: { icon: string; size?: number; tile?: boolean; className?: string }) {
  const Icon = SPACE_ICONS[icon] ?? BookOpen;
  if (!tile) return <Icon size={size} className={cn("shrink-0", className)} />;
  return (
    <span className={cn("inline-flex size-8.5 shrink-0 items-center justify-center rounded-pane bg-fill text-fg", className)}>
      <Icon size={size} />
    </span>
  );
}
