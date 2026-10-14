import { WorksheetScreen } from "../features/worksheets/WorksheetScreen";
import { useRef, type CSSProperties } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Tip from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { queryClient } from "../lib/queries";
import { LocaleKey } from "../lib/i18n/LocaleKey";
import { useUi, type Route } from "../stores/ui";
import { useApplyAppearance, useIsDark } from "./useTheme";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ContentCard } from "./ContentCard";
import { HomeScreen } from "../features/home/HomeScreen";
import { GoalWizardHost } from "../features/goal/GoalWizard";
import { SpaceDialogHost } from "../features/home/SpaceDialog";
import { SpaceScreen } from "../features/space/SpaceScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { ReviewScreen } from "../features/review/ReviewScreen";
import { PracticeScreen } from "../features/practice/PracticeScreen";
import { InsightsScreen } from "../features/insights/InsightsScreen";
import { ExamScreen } from "../features/exam/ExamScreen";
import { OutputScreen } from "../features/outputs/OutputScreen";
import { NotesScreen } from "../features/notes/NotesScreen";
import { CommandPalette } from "../features/palette/CommandPalette";
import { FocusLayer } from "../features/focus/FocusLayer";
import { SessionBar } from "../features/session/SessionBar";
import { QuizLayer } from "../features/placement/QuizDialog";
import { OnboardingHost } from "../features/onboarding/Onboarding";
import { TourHost } from "../features/onboarding/Tour";
import { QuickCaptureDialog } from "../features/capture/QuickCaptureDialog";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useBackgroundSync } from "./useBackgroundSync";
import { useInbox } from "./useInbox";
import { useDeepLinks } from "./useDeepLinks";
import { useStudyBuddy } from "../features/chat/useStudyBuddy";

const depth = (r: Route) =>
  r.name === "home" ? 0 : r.name === "practice" || (r.name === "settings" && r.page) ? 2 : 1;

function RouteScreen({ route }: { route: Route }) {
  if (route.name === "space") return <SpaceScreen key={route.spaceId} spaceId={route.spaceId} />;
  if (route.name === "settings")
    return (
      <ContentCard scroll={false}>
        <SettingsScreen />
      </ContentCard>
    );
  if (route.name === "review")
    return (
      <ContentCard scroll={false}>
        <ReviewScreen spaceId={route.spaceId} tab={route.tab} />
      </ContentCard>
    );
  if (route.name === "insights")
    return (
      <ContentCard scroll={false}>
        <InsightsScreen spaceId={route.spaceId} />
      </ContentCard>
    );
  if (route.name === "exam")
    return (
      <ContentCard scroll={false}>
        <ExamScreen key={route.spaceId ?? ""} spaceId={route.spaceId} attemptId={route.attemptId} />
      </ContentCard>
    );
  if (route.name === "output")
    return (
      <ContentCard scroll={false}>
        <OutputScreen key={route.outputId} spaceId={route.spaceId} outputId={route.outputId} />
      </ContentCard>
    );
  if (route.name === "worksheet")
    return (
      <ContentCard scroll={false}>
        <WorksheetScreen key={route.worksheetId} spaceId={route.spaceId} worksheetId={route.worksheetId} />
      </ContentCard>
    );
  if (route.name === "notes")
    return (
      <ContentCard scroll={false}>
        <NotesScreen key={route.spaceId} spaceId={route.spaceId} noteId={route.noteId} />
      </ContentCard>
    );
  if (route.name === "practice")
    return (
      <ContentCard scroll={false}>
        <PracticeScreen key={route.spaceId} spaceId={route.spaceId} topicKey={route.topicKey} />
      </ContentCard>
    );
  return (
    <ContentCard scroll={false}>
      <HomeScreen />
    </ContentCard>
  );
}

function Routes() {
  const route = useUi((st) => st.route);
  const prev = useRef({ key: "", depth: depth(route), dir: 1 });
  const key = `${route.name}:${"spaceId" in route ? route.spaceId : ""}:${route.name === "settings" ? (route.page?.kind ?? "") : ""}`;
  if (prev.current.key !== key) {
    const d = depth(route);
    prev.current = { key, depth: d, dir: d === prev.current.depth ? 1 : Math.sign(d - prev.current.depth) };
  }
  return (
    <div key={key} className="t-page-enter absolute inset-0" style={{ "--t-page-dir": prev.current.dir } as CSSProperties}>
      <RouteScreen route={route} />
    </div>
  );
}

function Shell() {
  useApplyAppearance();
  useGlobalShortcuts();
  useBackgroundSync();
  useDeepLinks();
  useInbox();
  useStudyBuddy();
  return (
    <div className="flex h-full bg-chrome text-fg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="relative min-h-0 flex-1">
          <Routes />
        </main>
      </div>
      <CommandPalette />
      <FocusLayer />
      <SessionBar />
      <QuizLayer />
      <QuickCaptureDialog />
      <SpaceDialogHost />
      <OnboardingHost />
      <TourHost />
      <GoalWizardHost />
    </div>
  );
}

export function App() {
  const isDark = useIsDark();
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleKey>
      <Tip.Provider>
        <Shell />
        <Toaster
          position="bottom-right"
          closeButton
          theme={isDark ? "dark" : "light"}
          toastOptions={{
            classNames: {
              toast: "!rounded-pane !border !border-border !bg-surface !text-fg !shadow-menu !font-sans !text-body",
              description: "!text-muted",
              actionButton: "!rounded-control !bg-primary !text-on-primary !font-semibold",
              cancelButton: "!rounded-control !bg-fill !text-fg",
              closeButton: "!border-border !bg-surface !text-muted hover:!text-fg",
              error: "[&_[data-icon]]:!text-danger [&_[data-title]]:!text-danger",
            },
          }}
        />
      </Tip.Provider>
      </LocaleKey>
    </QueryClientProvider>
  );
}
