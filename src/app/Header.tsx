import { ChevronRight, GraduationCap, Moon, Search, Settings, Sun } from "lucide-react";
import { Button } from "../components/ui/button";
import { Kbd, Tooltip } from "../components/ui/misc";
import { useSpace } from "../lib/queries";
import { s } from "../lib/strings";
import { SpaceIcon } from "../lib/spaceStyle";
import { useUi } from "../stores/ui";
import { FocusHeaderTimer } from "../features/focus/FocusHeaderTimer";
import { useIsDark } from "./useTheme";

function SpaceCrumb({ spaceId }: { spaceId: string }) {
  const { data } = useSpace(spaceId);
  if (!data) return null;
  return (
    <>
      <ChevronRight size={16} className="text-faint" />
      <span className="flex min-w-0 items-center gap-2">
        <SpaceIcon icon={data.icon} color={data.color} size={12} />
        <span className="truncate font-medium">{data.name}</span>
      </span>
    </>
  );
}

export function Header() {
  const route = useUi((st) => st.route);
  const navigate = useUi((st) => st.navigate);
  const setTheme = useUi((st) => st.setTheme);
  const setPaletteOpen = useUi((st) => st.setPaletteOpen);
  const isDark = useIsDark();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4" data-tauri-drag-region>
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-16" data-tauri-drag-region>
        <button
          onClick={() => navigate({ name: "home" })}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-surface-2"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-on-accent">
            <GraduationCap size={16} />
          </span>
          <span className="text-[0.9375rem] font-semibold">{s.appName}</span>
        </button>
        {route.name === "space" && <SpaceCrumb spaceId={route.spaceId} />}
        {route.name === "settings" && (
          <>
            <ChevronRight size={16} className="text-faint" />
            <span className="font-medium">{s.settings.title}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <FocusHeaderTimer />
        <Tooltip content={<span>{s.palette.placeholder} <Kbd>⌘K</Kbd></span>}>
          <Button variant="ghost" size="icon" aria-label="Command palette" onClick={() => setPaletteOpen(true)}>
            <Search size={18} />
          </Button>
        </Tooltip>
        <Tooltip content={s.palette.toggleTheme}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={s.palette.toggleTheme}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </Tooltip>
        <Tooltip content={s.common.settings}>
          <Button variant="ghost" size="icon" aria-label={s.common.settings} onClick={() => navigate({ name: "settings" })}>
            <Settings size={18} />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
