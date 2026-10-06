import {
  Atom, BookOpen, Bot, Brain, Calculator, Code2, Cpu, FlaskConical, Globe, GraduationCap, Languages, Music, Palette, Landmark, Leaf, type LucideIcon,
} from "lucide-react";

export const SPACE_ICONS: Record<string, LucideIcon> = {
  book: BookOpen,
  calculator: Calculator,
  code: Code2,
  cpu: Cpu,
  bot: Bot,
  flask: FlaskConical,
  atom: Atom,
  leaf: Leaf,
  globe: Globe,
  landmark: Landmark,
  languages: Languages,
  music: Music,
  palette: Palette,
  brain: Brain,
  graduation: GraduationCap,
};

/** [light bg, light fg, dark bg, dark fg] */
export const SPACE_COLORS: Record<string, [string, string, string, string]> = {
  blue: ["#d9e6fc", "#0b57d0", "#1f3a5f", "#a8c7fa"],
  green: ["#d5efdc", "#146c2e", "#1c3a26", "#8fd6a4"],
  amber: ["#fdecc8", "#8a5a00", "#3d2e0e", "#f3c062"],
  red: ["#fbdedc", "#b3261e", "#4a1d1a", "#f2b8b5"],
  purple: ["#ece0fb", "#6f3cc2", "#33224f", "#d3bbfa"],
  teal: ["#cff0ee", "#00696b", "#123a3b", "#7fd6d3"],
  pink: ["#fbdcec", "#a8336e", "#4a1c33", "#f5b2d3"],
  slate: ["#e3e7ed", "#3d4654", "#2e3238", "#c4cad3"],
};

export function SpaceIcon({ icon, color, size = 20, className }: { icon: string; color: string; size?: number; className?: string }) {
  const Icon = SPACE_ICONS[icon] ?? BookOpen;
  const c = SPACE_COLORS[color] ?? SPACE_COLORS.blue;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[14px] ${className ?? ""}`}
      style={{
        // light/dark pair resolved by CSS variables on the element
        ["--sb" as string]: c[0],
        ["--sf" as string]: c[1],
        ["--sbd" as string]: c[2],
        ["--sfd" as string]: c[3],
        width: size * 2,
        height: size * 2,
      }}
    >
      <Icon size={size} className="space-icon" />
    </span>
  );
}
