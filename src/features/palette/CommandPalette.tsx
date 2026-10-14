import { useEffect, useState } from "react";
import { Command } from "cmdk";
import * as D from "@radix-ui/react-dialog";
import { BarChart3, Brain, CalendarCheck, Download, FilePlus2, FileText, FolderSync, Gauge, GraduationCap, House, Layers, MessageSquareText, Notebook, NotebookPen, PencilLine, Plus, Search, Settings, Shapes, Sparkles, SquarePen, SunMoon, Timer, Upload, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSpaces, qk, useCaptureStatus } from "../../lib/queries";
import { splitShortcut } from "../../lib/capture/shortcut";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { SpaceIcon } from "../../lib/spaceStyle";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { Kbd } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { useLowEnergy } from "../focus/useLowEnergy";
import { useHasPlan } from "../plan/TodaySection";
import { exportStudyPack, importStudyPack } from "../packs/studyPack";

const item =
  "flex h-9 cursor-pointer items-center gap-2.5 rounded-control px-3 font-medium text-fg aria-selected:bg-fill-active data-[disabled=true]:cursor-default data-[disabled=true]:text-muted";
const group =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted";

export function CommandPalette() {
  const open = useUi((st) => st.paletteOpen);
  const setOpen = useUi((st) => st.setPaletteOpen);
  const ui = useUi();
  const { data: spaces } = useSpaces();
  const qc = useQueryClient();
  const spaceId = ui.route.name === "space" ? ui.route.spaceId : null;
  const { data: capture } = useCaptureStatus();
  const hasPlan = useHasPlan();
  const low = useLowEnergy(spaceId ?? undefined);
  const lowNote = low.active && <span className="text-label font-normal text-muted">{low.reason}</span>;
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const listed = query.trim() ? (spaces ?? []) : [...(spaces ?? [])].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)).slice(0, 2);

  const run = (fn: () => void | Promise<void>) => {
    setOpen(false);
    Promise.resolve(fn()).catch((e) => toastError(s.errors.generic, e));
  };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="t-modal-scrim fixed inset-0 z-40 bg-scrim" />
        <D.Content
          onFocusOutside={(e) => e.preventDefault()}
          aria-label={s.palette.placeholder}
          style={{ transformOrigin: "top center" }}
          className="t-modal fixed left-1/2 top-[96px] z-50 w-[min(602px,calc(100vw-30px))] -translate-x-1/2 overflow-hidden rounded-dialog border border-border bg-surface text-body shadow-dialog outline-none"
        >
          <D.Title className="sr-only">{s.palette.placeholder}</D.Title>
          <D.Description className="sr-only">{s.palette.placeholder}</D.Description>
          <Command loop>
            <div className="flex h-[53px] items-center gap-2.5 border-b border-divider px-4.5 text-faint">
              <Search size={16} />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={s.palette.placeholder}
                className="h-full flex-1 bg-transparent text-title-sm text-fg outline-none placeholder:text-faint"
              />
            </div>
            <Command.List className="max-h-[440px] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-body text-muted">{s.palette.empty}</Command.Empty>
              {spaces && spaces.length > 0 && (
                <Command.Group heading={s.palette.spaces} className={group}>
                  {listed.map((sp) => (
                    <Command.Item
                      key={sp.id}
                      value={`space ${sp.name} ${sp.id}`}
                      className={item}
                      onSelect={() => run(() => ui.navigate({ name: "space", spaceId: sp.id }))}
                    >
                      <SpaceIcon icon={sp.icon} tile={false} size={15} />
                      <span className="flex-1">{sp.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading={s.palette.actions} className={cn(group, spaces && spaces.length > 0 && "[&_[cmdk-group-heading]]:pt-2.5")}>
                {spaceId && (
                  <>
                    <Command.Item
                      className={item}
                      onSelect={() =>
                        run(async () => {
                          const t = await api.createThread(spaceId);
                          qc.invalidateQueries({ queryKey: qk.threads(spaceId) });
                          ui.setActiveThread(spaceId, t.id);
                        })
                      }
                    >
                      <SquarePen size={15} />
                      <span className="flex-1">{s.palette.newChat}</span>
                    </Command.Item>
                    <Command.Item className={item} disabled={low.active} onSelect={() => run(() => ui.setImportDialog({ open: true }))}>
                      <FilePlus2 size={15} />
                      <span className="flex-1">{s.palette.addSource}</span>
                      {lowNote}
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => ui.setWatchDialogOpen(true))} keywords={["folder", "watch", "sync"]}>
                      <FolderSync size={15} />
                      <span className="flex-1">{s.palette.watchedFolders}</span>
                    </Command.Item>
                    <Command.Item
                      className={item}
                      disabled={low.active}
                      onSelect={() => run(() => ui.navigate({ name: "practice", spaceId }))}
                      keywords={["practice", "problems", "exercises", "drill"]}
                    >
                      <PencilLine size={15} />
                      <span className="flex-1">{s.practice.title}</span>
                      {lowNote}
                    </Command.Item>
                    <Command.Item
                      className={item}
                      onSelect={() =>
                        run(() => {
                          if (!ui.studioOpen) ui.toggleStudio();
                          ui.setStudioView("create");
                        })
                      }
                      keywords={["create", "report", "slides", "mind map", "worksheet", "timeline", "table", "diagram", "infographic", "cheat sheet"]}
                    >
                      <Shapes size={15} />
                      <span className="flex-1">{s.palette.create}</span>
                    </Command.Item>
                    <Command.Item
                      className={item}
                      onSelect={() => run(() => ui.openWorksheetBuilder(spaceId))}
                      keywords={["worksheet", "arbeitsblatt", "klassenarbeit", "test", "quiz", "print", "pdf", "docx"]}
                    >
                      <FileText size={15} />
                      <span className="flex-1">{s.palette.worksheet}</span>
                    </Command.Item>
                    <Command.Item
                      className={item}
                      onSelect={() =>
                        run(() => {
                          if (!ui.studioOpen) ui.toggleStudio();
                          ui.setStudioView("feynman");
                        })
                      }
                      keywords={["feynman", "explain", "teach", "own words", "check understanding"]}
                    >
                      <MessageSquareText size={15} />
                      <span className="flex-1">{s.palette.feynman}</span>
                    </Command.Item>
                  </>
                )}
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "home" }))}>
                  <House size={15} />
                  <span className="flex-1">{s.palette.goHome}</span>
                </Command.Item>
                {hasPlan && (
                  <Command.Item
                    className={item}
                    onSelect={() =>
                      run(() => {
                        ui.navigate({ name: "home" });
                        setTimeout(() => document.getElementById("today")?.scrollIntoView({ block: "start" }), 60);
                      })
                    }
                    keywords={["plan", "schedule"]}
                  >
                    <CalendarCheck size={15} />
                    <span className="flex-1">{s.palette.today}</span>
                  </Command.Item>
                )}
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "review" }))} keywords={["flashcards", "cards", "fsrs", "due"]}>
                  <Layers size={15} />
                  <span className="flex-1">{s.palette.review}</span>
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "review", tab: "mistakes" }))} keywords={["mistakes", "wrong"]}>
                  <Notebook size={15} />
                  <span className="flex-1">{s.palette.mistakes}</span>
                </Command.Item>
                <Command.Item
                  className={item}
                  onSelect={() =>
                    run(() => {
                      ui.navigate({ name: "home" });
                      ui.setSpaceDialogOpen(true);
                    })
                  }
                  keywords={["create"]}
                >
                  <Plus size={15} />
                  <span className="flex-1">{s.palette.newSpace}</span>
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.setFocusDialogOpen(true))}>
                  <Timer size={15} />
                  <span className="flex-1">{s.palette.startFocus}</span>
                  <Kbd keys={["⌘", "⇧", "F"]} />
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.setCaptureOpen(true))} keywords={["note", "capture", "jot"]}>
                  <Zap size={15} />
                  <span className="flex-1">{s.palette.quickCapture}</span>
                  {capture?.enabled && <Kbd keys={splitShortcut(capture.shortcut)} />}
                </Command.Item>
                <Command.Item
                  className={item}
                  onSelect={() => run(() => ui.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"))}
                >
                  <SunMoon size={15} />
                  <span className="flex-1">{s.palette.toggleTheme}</span>
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.setReduceMotion(!ui.reduceMotion))} keywords={["animation"]}>
                  <Gauge size={15} />
                  <span className="flex-1">{s.palette.toggleMotion}</span>
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.setVisualEffects(!ui.visualEffects))} keywords={["animation"]}>
                  <Sparkles size={15} />
                  <span className="flex-1">{s.palette.toggleEffects}</span>
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => ui.navigate({ name: "settings" }))}>
                  <Settings size={15} />
                  <span className="flex-1">{s.palette.openSettings}</span>
                  <Kbd keys={["⌘", ","]} />
                </Command.Item>
                <Command.Item
                  className={item}
                  onSelect={() => run(() => ui.navigate({ name: "settings", section: "memory" }))}
                  keywords={["memory", "profile", "about me"]}
                >
                  <Brain size={15} />
                  <span className="flex-1">{s.memory.title}</span>
                </Command.Item>
                <Command.Item
                  className={item}
                  onSelect={() => run(() => ui.navigate({ name: "insights", spaceId: spaceId ?? undefined }))}
                  keywords={["stats", "progress", "retention", "mastery", "readiness"]}
                >
                  <BarChart3 size={15} />
                  <span className="flex-1">{s.palette.insights}</span>
                </Command.Item>
                <Command.Item
                  className={item}
                  onSelect={() => run(() => ui.navigate({ name: "exam", spaceId: spaceId ?? undefined }))}
                  keywords={["exam", "test", "mock", "ged", "sat", "timed"]}
                >
                  <GraduationCap size={15} />
                  <span className="flex-1">{s.palette.exam}</span>
                </Command.Item>
                {spaceId && (
                  <Command.Item
                    className={item}
                    onSelect={() => run(() => ui.navigate({ name: "notes", spaceId }))}
                    keywords={["notes", "write", "backlinks", "markdown", "glossary"]}
                  >
                    <NotebookPen size={15} />
                    <span className="flex-1">{s.palette.notes}</span>
                  </Command.Item>
                )}
                {spaceId && (
                  <Command.Item
                    className={item}
                    onSelect={() => run(() => exportStudyPack(spaceId, spaces?.find((x) => x.id === spaceId)?.name ?? ""))}
                    keywords={["share", "export", "pack", "ponderpack"]}
                  >
                    <Download size={15} />
                    <span className="flex-1">{s.pack.export}</span>
                  </Command.Item>
                )}
                <Command.Item className={item} onSelect={() => run(importStudyPack)} keywords={["share", "import", "pack", "ponderpack", "open"]}>
                  <Upload size={15} />
                  <span className="flex-1">{s.pack.import}</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
