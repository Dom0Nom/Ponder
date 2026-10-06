import { Command } from "cmdk";
import * as D from "@radix-ui/react-dialog";
import { Brain, FilePlus2, Dumbbell, FolderSync, GraduationCap, Home, ListX, MessageSquarePlus, Moon, NotebookPen, Plus, Settings, Timer } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSpaces, qk, useCaptureStatus } from "../../lib/queries";
import { formatShortcut } from "../../lib/capture/shortcut";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { SpaceIcon } from "../../lib/spaceStyle";
import { useUi } from "../../stores/ui";
import { toastError } from "../../components/ui/toast";

const item =
  "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-fg aria-selected:bg-surface-2";

export function CommandPalette() {
  const open = useUi((st) => st.paletteOpen);
  const setOpen = useUi((st) => st.setPaletteOpen);
  const ui = useUi();
  const { data: spaces } = useSpaces();
  const qc = useQueryClient();
  const spaceId = ui.route.name === "space" ? ui.route.spaceId : null;
  const { data: capture } = useCaptureStatus();

  const run = (fn: () => void | Promise<void>) => {
    setOpen(false);
    Promise.resolve(fn()).catch((e) => toastError(s.errors.generic, e));
  };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/25" />
        <D.Content
          onFocusOutside={(e) => e.preventDefault()}
          aria-label={s.palette.placeholder}
          className="fixed left-1/2 top-[14vh] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[20px] bg-surface shadow-2xl"
        >
          <D.Title className="sr-only">{s.palette.placeholder}</D.Title>
          <D.Description className="sr-only">{s.palette.placeholder}</D.Description>
          <Command loop>
            <Command.Input
              autoFocus
              placeholder={s.palette.placeholder}
              className="h-14 w-full border-b border-border bg-transparent px-5 text-[0.9375rem] outline-none placeholder:text-faint"
            />
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">{s.palette.empty}</Command.Empty>
              <Command.Group heading={s.palette.actions} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                {spaceId && (
                  <>
                    <Command.Item className={item} onSelect={() => run(async () => {
                      const t = await api.createThread(spaceId);
                      qc.invalidateQueries({ queryKey: qk.threads(spaceId) });
                      ui.setActiveThread(spaceId, t.id);
                    })}>
                      <MessageSquarePlus size={17} className="text-muted" /> {s.palette.newChat}
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => ui.setImportDialog({ open: true }))}>
                      <FilePlus2 size={17} className="text-muted" /> {s.palette.addSource}
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => ui.setWatchDialogOpen(true))} keywords={["folder", "watch", "sync"]}>
                      <FolderSync size={17} className="text-muted" /> {s.palette.watchedFolders}
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "practice", spaceId }))} keywords={["practice", "problems", "exercises", "drill"]}>
                      <Dumbbell size={17} className="text-muted" /> {s.practice.title}
                    </Command.Item>
                  </>
                )}
                <Command.Item className={item} onSelect={() => run(() => ui.setCaptureOpen(true))} keywords={["note", "capture", "jot"]}>
                  <NotebookPen size={17} className="text-muted" /> {s.palette.quickCapture}
                  {capture?.enabled && <span className="ml-auto text-xs text-faint">{formatShortcut(capture.shortcut)}</span>}
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.setFocusDialogOpen(true))}>
                  <Timer size={17} className="text-muted" /> {s.palette.startFocus}
                  <span className="ml-auto text-xs text-faint">⌘⇧F</span>
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "review" }))} keywords={["flashcards", "cards", "fsrs", "due"]}>
                  <GraduationCap size={17} className="text-muted" /> {s.palette.review}
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "review", tab: "mistakes" }))} keywords={["mistakes", "wrong"]}>
                  <ListX size={17} className="text-muted" /> {s.palette.mistakes}
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "home" }))}>
                  <Home size={17} className="text-muted" /> {s.palette.goHome}
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "home" }))} keywords={["create"]}>
                  <Plus size={17} className="text-muted" /> {s.palette.newSpace}
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "settings" }))}>
                  <Settings size={17} className="text-muted" /> {s.palette.openSettings}
                  <span className="ml-auto text-xs text-faint">⌘,</span>
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "settings", section: "memory" }))} keywords={["memory", "profile", "about me"]}>
                  <Brain size={17} className="text-muted" /> {s.memory.title}
                </Command.Item>
                <Command.Item
                  className={item}
                  onSelect={() => run(() => ui.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"))}
                >
                  <Moon size={17} className="text-muted" /> {s.palette.toggleTheme}
                </Command.Item>
              </Command.Group>
              {spaces && spaces.length > 0 && (
                <Command.Group heading={s.palette.spaces} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                  {spaces.map((sp) => (
                    <Command.Item
                      key={sp.id}
                      value={`space ${sp.name} ${sp.id}`}
                      className={item}
                      onSelect={() => run(() => ui.navigate({ name: "space", spaceId: sp.id }))}
                    >
                      <SpaceIcon icon={sp.icon} color={sp.color} size={11} />
                      {sp.name}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
