import { useEffect } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { qk, queryClient, useSpace } from "../../lib/queries";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton, Tooltip } from "../../components/ui/misc";
import { SourcesPane } from "../sources/SourcesPane";
import { ChatPane } from "../chat/ChatPane";
import { StudioPane } from "./StudioPane";
import { SourceViewer } from "../sources/SourceViewer";
import { AddCardDialog } from "../cards/FlashcardsCard";
import { cn, relativeTime } from "../../lib/utils";

export function Pane({
  title,
  children,
  actions,
  className,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-pane)] bg-surface shadow-card", className)}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <h2 className="text-[0.9375rem] font-medium">{title}</h2>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function CollapsedRail({ label, onExpand, side }: { label: string; onExpand: () => void; side: "left" | "right" }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center rounded-[var(--radius-pane)] bg-surface py-2 shadow-card">
      <Tooltip content={`${s.panes.expand}: ${label}`} side={side === "left" ? "right" : "left"}>
        <Button variant="ghost" size="icon" aria-label={`${s.panes.expand}: ${label}`} onClick={onExpand}>
          {side === "left" ? <PanelLeftOpen size={18} /> : <PanelRightOpen size={18} />}
        </Button>
      </Tooltip>
      <span className="mt-3 text-xs font-medium text-muted [writing-mode:vertical-rl]">{label}</span>
    </div>
  );
}

/** One line for the home card: where the learner left off. */
async function writeRecap(spaceId: string) {
  const [threads, journal] = await Promise.all([api.listThreads(spaceId), api.listJournal(spaceId)]);
  const lastThread = threads[0];
  const lastJournal = journal[0];
  let recap: string | null = null;
  if (lastJournal && (!lastThread || lastJournal.createdAt >= lastThread.updatedAt)) {
    const line = lastJournal.content.split("\n").find((l) => /^[-*] /.test(l.trim()));
    recap = line ? `Last session: ${line.trim().replace(/^[-*] /, "")}` : `Last session ${relativeTime(lastJournal.createdAt)}`;
  } else if (lastThread && lastThread.title !== "New chat") {
    recap = `Last chat: “${lastThread.title}” · ${relativeTime(lastThread.updatedAt)}`;
  }
  if (recap) {
    await api.updateSpace(spaceId, { recap });
    queryClient.invalidateQueries({ queryKey: qk.spaces });
  }
}

export function SpaceScreen({ spaceId }: { spaceId: string }) {
  const { data: space, isLoading, error, refetch } = useSpace(spaceId);
  const panes = useUi((st) => st.panes);
  const togglePane = useUi((st) => st.togglePane);
  const viewer = useUi((st) => st.viewer);

  useEffect(() => {
    api.touchSpace(spaceId).catch(() => {});
    return () => {
      writeRecap(spaceId).catch(() => {});
    };
  }, [spaceId]);

  if (isLoading)
    return (
      <div className="flex h-full gap-3 px-3 pb-3">
        <Skeleton className="w-80 rounded-[var(--radius-pane)]" />
        <Skeleton className="flex-1 rounded-[var(--radius-pane)]" />
        <Skeleton className="w-80 rounded-[var(--radius-pane)]" />
      </div>
    );
  if (error || !space)
    return (
      <ErrorState
        className="pt-24"
        title={s.space.notFound}
        error={error}
        onRetry={() => refetch()}
      />
    );

  return (
    <div className="flex h-full gap-3 px-3 pb-3">
      <AddCardDialog space={space} />
      {panes.sources ? (
        <Pane
          title={s.panes.sources}
          testId="pane-sources"
          className={cn("shrink-0", viewer ? "w-[min(560px,42vw)]" : "w-[clamp(260px,24vw,340px)]")}
          actions={
            <Tooltip content={s.panes.collapse}>
              <Button variant="ghost" size="icon-sm" aria-label={`${s.panes.collapse}: ${s.panes.sources}`} onClick={() => togglePane("sources")}>
                <PanelLeftClose size={17} />
              </Button>
            </Tooltip>
          }
        >
          {viewer ? <SourceViewer key={viewer.sourceId} target={viewer} /> : <SourcesPane space={space} />}
        </Pane>
      ) : (
        <CollapsedRail label={s.panes.sources} side="left" onExpand={() => togglePane("sources")} />
      )}
      <ChatPane space={space} />
      {panes.studio ? (
        <Pane
          title={s.panes.studio}
          testId="pane-studio"
          className="w-[clamp(260px,24vw,340px)] shrink-0"
          actions={
            <Tooltip content={s.panes.collapse}>
              <Button variant="ghost" size="icon-sm" aria-label={`${s.panes.collapse}: ${s.panes.studio}`} onClick={() => togglePane("studio")}>
                <PanelRightClose size={17} />
              </Button>
            </Tooltip>
          }
        >
          <StudioPane space={space} />
        </Pane>
      ) : (
        <CollapsedRail label={s.panes.studio} side="right" onExpand={() => togglePane("studio")} />
      )}
    </div>
  );
}
