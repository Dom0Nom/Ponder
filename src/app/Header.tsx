import { useState } from "react";
import { ArrowLeft, Calculator, ChevronDown, Pencil, PanelLeft, PanelRight, Pin, PinOff, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { Kbd, Tooltip } from "../components/ui/misc";
import { toastError } from "../components/ui/toast";
import { api } from "../lib/ipc";
import { qk, usePinThread, useSpace, useThreads } from "../lib/queries";
import { s } from "../lib/strings";
import { useUi } from "../stores/ui";
import { FocusHeaderTimer } from "../features/focus/FocusHeaderTimer";
import { useActiveThread } from "../features/chat/useActiveThread";
import { backTarget } from "./back";

const Sep = () => (
  <span aria-hidden className="text-faint">
    /
  </span>
);

const crumbLink = "whitespace-nowrap font-medium text-fg-secondary hover:text-fg";
const crumbCurrent = "min-w-0 truncate whitespace-nowrap font-medium";

function SpaceTitle({ spaceId }: { spaceId: string }) {
  const { data: space } = useSpace(spaceId);
  const active = useActiveThread(spaceId);
  const loading = useThreads(spaceId).isLoading;
  const viewing = useUi((st) => st.viewer !== null);
  const setRenaming = useUi((st) => st.setRenamingThread);
  const pin = usePinThread(spaceId);
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  if (!space) return null;
  if (!active || viewing)
    return (
      <>
        <span className="whitespace-nowrap font-medium text-fg-secondary" data-tauri-drag-region>
          {space.name}
        </span>
        <Sep />
        <span className={crumbCurrent} data-tauri-drag-region>
          {viewing ? s.panes.sources : loading ? "" : s.chat.newThread}
        </span>
      </>
    );

  return (
    <>
      <span className="whitespace-nowrap font-medium text-fg-secondary" data-tauri-drag-region>
        {space.name}
      </span>
      <Sep />
      <Menu>
        <MenuTrigger asChild>
          <button
            className="-ml-2 flex h-7 min-w-0 items-center gap-1.5 rounded-btn pl-2 pr-1.5 font-medium hover:bg-fill-active data-[state=open]:bg-fill-active"
          >
            <span className="truncate">{active.title}</span>
            <ChevronDown size={13} className="shrink-0 text-muted" />
          </button>
        </MenuTrigger>
        <MenuContent className="w-[180px]" align="start">
          <MenuItem onSelect={() => setRenaming(active.id)}>
            <Pencil size={14} /> {s.common.rename}
          </MenuItem>
          <MenuItem onSelect={() => pin.mutate({ id: active.id, pinned: !active.pinned })}>
            {active.pinned ? <PinOff size={14} /> : <Pin size={14} />} {active.pinned ? s.chat.unpin : s.chat.pin}
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => setDeleting(true)}>
            <Trash2 size={14} /> {s.chat.deleteThread}
          </MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`${s.chat.deleteThread}?`}
        body={`“${active.title}” and its messages are deleted.`}
        confirmLabel={s.common.delete}
        danger
        onConfirm={async () => {
          try {
            await api.deleteThread(active.id);
            qc.invalidateQueries({ queryKey: qk.threads(spaceId) });
          } catch (e) {
            toastError(s.errors.generic, e);
          }
        }}
      />
    </>
  );
}

function BackButton() {
  const route = useUi((st) => st.route);
  const backRoute = useUi((st) => st.backRoute);
  const navigate = useUi((st) => st.navigate);
  const target = backTarget(route, backRoute);
  const spaceId = target && "spaceId" in target ? target.spaceId : undefined;
  const { data: space } = useSpace(spaceId ?? "");
  if (!target) return null;
  const label =
    target.name === "space" && space ? s.common.backTo(space.name)
    : target.name === "practice" ? s.common.backTo(s.practice.title)
    : target.name === "home" ? s.common.backTo(s.shell.home)
    : s.common.back;
  return (
    <Tooltip
      content={
        <>
          {label} <Kbd keys={["⌘", "["]} />
        </>
      }
    >
      <Button variant="chrome" size="icon-sm" aria-label={label} onClick={() => navigate(target)}>
        <ArrowLeft size={16} />
      </Button>
    </Tooltip>
  );
}

function ReviewCrumbs({ spaceId }: { spaceId?: string }) {
  const navigate = useUi((st) => st.navigate);
  const { data: space } = useSpace(spaceId ?? "");
  return (
    <>
      {spaceId && space && (
        <>
          <button className={crumbLink} onClick={() => navigate({ name: "space", spaceId })}>
            {space.name}
          </button>
          <Sep />
        </>
      )}
      <span className={crumbCurrent} data-tauri-drag-region>
        {s.review.title}
      </span>
    </>
  );
}

function PracticeCrumbs({ spaceId, topicTitle }: { spaceId: string; topicTitle?: string }) {
  const navigate = useUi((st) => st.navigate);
  const { data: space } = useSpace(spaceId);
  return (
    <>
      {space && (
        <>
          <button className={crumbLink} onClick={() => navigate({ name: "space", spaceId })}>
            {space.name}
          </button>
          <Sep />
        </>
      )}
      {topicTitle ? (
        <>
          <button className={crumbLink} onClick={() => navigate({ name: "practice", spaceId })}>
            {s.practice.title}
          </button>
          <Sep />
          <span className={crumbCurrent} data-tauri-drag-region>
            {topicTitle}
          </span>
        </>
      ) : (
        <span className={crumbCurrent} data-tauri-drag-region>
          {s.practice.title}
        </span>
      )}
    </>
  );
}

export function Header() {
  const route = useUi((st) => st.route);
  const sidebarOpen = useUi((st) => st.sidebarOpen);
  const toggleSidebar = useUi((st) => st.toggleSidebar);
  const studioOpen = useUi((st) => st.studioOpen);
  const toggleStudio = useUi((st) => st.toggleStudio);
  const calcOpen = useUi((st) => st.studioOpen && st.studioView === "calculator");

  const toggleCalculator = () => {
    const ui = useUi.getState();
    ui.setStudioView(calcOpen ? null : "calculator");
    if (!ui.studioOpen) useUi.setState({ studioOpen: true });
  };

  return (
    <header data-tauri-drag-region className="flex h-[48px] shrink-0 items-center gap-3 pl-3 pr-4">
      {!sidebarOpen && <span className="w-[64px] shrink-0" data-tauri-drag-region />}
      <Tooltip
        content={
          <>
            {s.shell.toggleSidebar} <Kbd keys={["⌘", "\\"]} />
          </>
        }
      >
        <Button
          variant="chrome"
          size="icon-sm"
          aria-label={s.shell.toggleSidebar}
          aria-pressed={sidebarOpen}
          onClick={toggleSidebar}
        >
          <PanelLeft size={16} />
        </Button>
      </Tooltip>
      <BackButton />
      <div className="flex min-w-0 items-center gap-3" data-tauri-drag-region>
        {route.name === "home" && (
          <span className={crumbCurrent} data-tauri-drag-region>
            {s.shell.home}
          </span>
        )}
        {route.name === "settings" && (
          <span className={crumbCurrent} data-tauri-drag-region>
            {s.common.settings}
          </span>
        )}
        {route.name === "review" && <ReviewCrumbs spaceId={route.spaceId} />}
        {route.name === "practice" && <PracticeCrumbs spaceId={route.spaceId} topicTitle={route.topicTitle} />}
        {route.name === "space" && <SpaceTitle spaceId={route.spaceId} />}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <FocusHeaderTimer />
        {route.name === "space" && (
          <Tooltip content={s.calc.title}>
            <Button
              variant="chrome"
              className="h-7 gap-2 rounded-btn px-2.5 font-normal"
              aria-pressed={calcOpen}
              onClick={toggleCalculator}
            >
              <Calculator size={14} />
              {s.calc.button}
            </Button>
          </Tooltip>
        )}
        {route.name === "space" && (
          <Button
            variant="chrome"
            className="h-7 gap-2 rounded-btn px-2.5 font-normal"
            aria-pressed={studioOpen}
            onClick={toggleStudio}
          >
            <PanelRight size={14} />
            {s.panes.studio}
            <Kbd keys={["⌘", "⇧", "T"]} className={studioOpen ? "text-fg" : undefined} />
          </Button>
        )}
      </div>
    </header>
  );
}
