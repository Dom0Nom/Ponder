import { useEffect, type CSSProperties } from "react";
import { qk, queryClient, useSpace } from "../../lib/queries";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { ContentCard } from "../../app/ContentCard";
import { SourcesHost, SourcesPanel } from "../sources/SourcesPanel";
import { ChatPane } from "../chat/ChatPane";
import { StudioPanel } from "./StudioPanel";
import { SourceViewer } from "../sources/SourceViewer";
import { AddCardDialog } from "../cards/FlashcardsCard";
import { cn, relativeTime } from "../../lib/utils";
import { useStayMounted } from "../../components/motion/useStayMounted";
import { usePageSlide } from "../../components/motion/usePageSlide";

/** One line for the home card: where the learner left off. */
async function writeRecap(spaceId: string) {
  const [threads, journal] = await Promise.all([api.listThreads(spaceId), api.listJournal(spaceId)]);
  const lastThread = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0];
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
  const studioOpen = useUi((st) => st.studioOpen);
  const sourcesOpen = useUi((st) => st.sourcesOpen[spaceId] === true);
  const viewer = useUi((st) => st.viewer);
  const studioMounted = useStayMounted(studioOpen, 200);
  const { page, sub: viewerTarget } = usePageSlide(viewer);

  useEffect(() => {
    api.touchSpace(spaceId).catch(() => {});
    return () => {
      writeRecap(spaceId).catch(() => {});
    };
  }, [spaceId]);

  if (isLoading)
    return (
      <div className="relative h-full">
        <Skeleton className="absolute bottom-2 left-0 right-[336px] top-0 rounded-pane" />
        <Skeleton className="absolute bottom-0 right-0 top-0 w-[328px]" />
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
    <div className="relative h-full">
      <AddCardDialog space={space} />
      <ContentCard scroll={false} className={cn("border-0 after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-pane after:border after:border-border transition-[left,right] duration-200", studioOpen ? "right-[336px]" : "right-2")}>
        <section aria-label={s.panes.chat} data-testid="pane-chat" className="relative flex h-full min-w-0 flex-col">
          <div className="t-page-slide min-h-0 flex-1" data-page={page}>
            <div className="t-page flex flex-col" data-page-id="1" inert={page === 2}>
              <ChatPane space={space} />
            </div>
            {viewerTarget && (
              <div
                className="t-page flex flex-col transition-[padding] duration-200"
                data-page-id="2"
                inert={page === 1}
                style={{ paddingLeft: sourcesOpen ? 340 : 0 }}
              >
                <SourceViewer key={viewerTarget.sourceId} target={viewerTarget} />
              </div>
            )}
          </div>
          <SourcesPanel space={space} open={sourcesOpen} />
          <SourcesHost space={space} />
        </section>
      </ContentCard>
      {studioMounted && (
        <section
          aria-label={s.panes.studio}
          data-testid="pane-studio"
          data-open={studioOpen}
          inert={!studioOpen}
          style={{ "--panel-translate-x": "16px", "--panel-translate-y": "0px" } as CSSProperties}
          className="t-panel-slide absolute bottom-0 right-0 top-0 flex w-[328px] flex-col overflow-hidden border-l border-t border-border bg-surface"
        >
          <StudioPanel space={space} />
        </section>
      )}
    </div>
  );
}
