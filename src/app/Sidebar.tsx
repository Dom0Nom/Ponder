import { ArrowLeft, Files, House, Layers, PencilLine, Search, Settings } from "lucide-react";
import { useRef, type ComponentType, type ReactNode } from "react";
import markDark from "../assets/brand/ponder-mark-dark-tight.png";
import markLight from "../assets/brand/ponder-mark-light-tight.png";
import wordDark from "../assets/brand/ponder-wordmark-dark-tight.png";
import wordLight from "../assets/brand/ponder-wordmark-light-tight.png";
import { NumberPop } from "../components/motion/NumberPop";
import { Button } from "../components/ui/button";
import { Kbd, Tooltip } from "../components/ui/misc";
import { useDueCounts, useSources, useSpaces } from "../lib/queries";
import { s } from "../lib/strings";
import { cn } from "../lib/utils";
import { useUi } from "../stores/ui";
import { SidebarThreadListSlot } from "./SidebarThreadListSlot";
import { useFullscreen } from "./useFullscreen";
import { useIsDark } from "./useTheme";

function NavItem({
  icon: Icon,
  label,
  current,
  count,
  hint,
  disabled,
  onClick,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  current?: boolean;
  count?: number;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const shown = useRef(count ?? 0);
  if (count) shown.current = count;
  return (
    <button
      aria-current={current ? "page" : undefined}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-3 whitespace-nowrap rounded-btn px-4 text-left font-medium hover:bg-fill-active aria-[current=page]:font-semibold aria-[current=page]:bg-selected aria-[current=page]:hover:bg-selected",
        disabled && "opacity-50",
      )}
    >
      <Icon size={16} />
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <span className="t-badge" data-open={count > 0} aria-hidden={count === 0 || undefined}>
          <span className="t-badge-dot text-meta font-semibold text-muted">
            <NumberPop text={String(count || shown.current)} popKey={count || shown.current} />
          </span>
        </span>
      )}
      {hint && <span className="font-kbd text-meta font-semibold tracking-[.12em] text-muted">{hint}</span>}
    </button>
  );
}

function SearchButton() {
  const setPaletteOpen = useUi((st) => st.setPaletteOpen);
  return (
    <button
      onClick={() => setPaletteOpen(true)}
      className="mb-2 flex h-[34px] shrink-0 cursor-text items-center gap-2 whitespace-nowrap rounded-btn border border-field bg-surface pl-2.5 pr-1.5 text-muted"
    >
      <Search size={14} className="text-fg" />
      <span className="flex-1 text-left">{s.shell.search}</span>
      <Kbd keys={["⌘", "K"]} />
    </button>
  );
}

function usePracticeSpaceId(): string | undefined {
  const route = useUi((st) => st.route);
  const { data: spaces } = useSpaces();
  if ((route.name === "space" || route.name === "practice" || route.name === "review") && route.spaceId) return route.spaceId;
  return [...(spaces ?? [])].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0]?.id;
}

function SidebarBody() {
  const route = useUi((st) => st.route);
  const sourcesOpen = useUi((st) => (route.name === "space" ? st.sourcesOpen[route.spaceId] === true : false));
  const settingsReturn = useUi((st) => st.settingsReturn);
  const navigate = useUi((st) => st.navigate);
  const setSourcesOpen = useUi((st) => st.setSourcesOpen);
  const { data: due } = useDueCounts();
  const hasSources = (useSources(route.name === "space" ? route.spaceId : "").data ?? []).length > 0;
  const practiceSpaceId = usePracticeSpaceId();
  const reviewCount = (due ?? []).reduce((n, c) => n + c.due + c.new, 0);

  if (route.name === "settings") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 pb-3 pt-2">
        <SearchButton />
        <NavItem icon={ArrowLeft} label={s.common.back} onClick={() => navigate(settingsReturn)} />
      </div>
    );
  }

  const isSpace = route.name === "space";
  const practice = (
    <NavItem
      icon={PencilLine}
      label={s.practice.title}
      current={route.name === "practice"}
      disabled={!practiceSpaceId}
      onClick={() => practiceSpaceId && navigate({ name: "practice", spaceId: practiceSpaceId })}
    />
  );

  const gear: ReactNode = (
    <div className={isSpace ? "mt-1.5 flex" : "mt-auto flex"}>
      <Tooltip
        content={
          <>
            {s.common.settings} <Kbd keys={["⌘", ","]} />
          </>
        }
      >
        <Button variant="chrome" size="icon" aria-label={s.common.settings} className="ml-1" onClick={() => navigate({ name: "settings" })}>
          <Settings size={16} />
        </Button>
      </Tooltip>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 pb-3 pt-2">
      <SearchButton />
      <NavItem icon={House} label={s.shell.home} current={route.name === "home"} onClick={() => navigate({ name: "home" })} />
      {isSpace && hasSources && (
        <NavItem
          icon={Files}
          label={s.panes.sources}
          hint="⌘⇧S"
          current={sourcesOpen}
          onClick={() => setSourcesOpen(route.spaceId, !sourcesOpen)}
        />
      )}
      <NavItem
        icon={Layers}
        label={s.review.title}
        count={reviewCount}
        current={route.name === "review"}
        onClick={() => navigate({ name: "review" })}
      />
      {!practiceSpaceId ? (
        <Tooltip content={s.shell.practiceNeedsSpace} side="right">
          <div className="flex flex-col">{practice}</div>
        </Tooltip>
      ) : (
        practice
      )}
      {isSpace && (
        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarThreadListSlot spaceId={route.spaceId} />
        </div>
      )}
      {gear}
    </div>
  );
}

export function Sidebar() {
  const open = useUi((st) => st.sidebarOpen);
  const dark = useIsDark();
  const fullscreen = useFullscreen();
  return (
    <aside
      aria-label={s.shell.sidebar}
      inert={!open}
      style={{ width: open ? 232 : 0 }}
      className="relative z-[5] h-full shrink-0 overflow-hidden bg-chrome transition-[width] duration-[180ms] ease-[ease]"
    >
      <div className={cn("flex h-full w-[232px] flex-col transition-opacity duration-150", open ? "opacity-100" : "opacity-0")}>
        <div className="relative h-[48px] shrink-0" data-tauri-drag-region>
          <div
            role="img"
            aria-label={s.appName}
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 flex items-center justify-center gap-[7px]",
              fullscreen ? "left-0" : "left-[76px]",
            )}
          >
            <img src={dark ? markDark : markLight} alt="" draggable={false} className="h-[22px] w-auto" />
            <img src={dark ? wordDark : wordLight} alt="" draggable={false} className="h-[18px] w-auto" />
          </div>
        </div>
        <SidebarBody />
      </div>
    </aside>
  );
}
