import { QueryClientProvider } from "@tanstack/react-query";
import * as Tip from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { queryClient } from "../lib/queries";
import { useUi } from "../stores/ui";
import { useApplyAppearance, useIsDark } from "./useTheme";
import { Header } from "./Header";
import { HomeScreen } from "../features/home/HomeScreen";
import { SpaceScreen } from "../features/space/SpaceScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { ReviewScreen } from "../features/review/ReviewScreen";
import { PracticeScreen } from "../features/practice/PracticeScreen";
import { CommandPalette } from "../features/palette/CommandPalette";
import { FocusLayer } from "../features/focus/FocusLayer";
import { QuizLayer } from "../features/placement/QuizDialog";
import { QuickCaptureDialog } from "../features/capture/QuickCaptureDialog";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useBackgroundSync } from "./useBackgroundSync";
import { useStudyBuddy } from "../features/chat/useStudyBuddy";

function Routes() {
  const route = useUi((st) => st.route);
  if (route.name === "space") return <SpaceScreen key={route.spaceId} spaceId={route.spaceId} />;
  if (route.name === "settings") return <SettingsScreen />;
  if (route.name === "review") return <ReviewScreen spaceId={route.spaceId} tab={route.tab} />;
  if (route.name === "practice") return <PracticeScreen key={route.spaceId} spaceId={route.spaceId} topicKey={route.topicKey} />;
  return <HomeScreen />;
}

function Shell() {
  useApplyAppearance();
  useGlobalShortcuts();
  useBackgroundSync();
  useStudyBuddy();
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="min-h-0 flex-1">
        <Routes />
      </main>
      <CommandPalette />
      <FocusLayer />
      <QuizLayer />
      <QuickCaptureDialog />
    </div>
  );
}

export function App() {
  const isDark = useIsDark();
  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
