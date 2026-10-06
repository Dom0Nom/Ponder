import { QueryClientProvider } from "@tanstack/react-query";
import * as Tip from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { queryClient } from "../lib/queries";
import { useUi } from "../stores/ui";
import { useApplyAppearance } from "./useTheme";
import { Header } from "./Header";
import { HomeScreen } from "../features/home/HomeScreen";
import { SpaceScreen } from "../features/space/SpaceScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { CommandPalette } from "../features/palette/CommandPalette";
import { FocusLayer } from "../features/focus/FocusLayer";
import { QuizLayer } from "../features/placement/QuizDialog";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useBackgroundSync } from "./useBackgroundSync";
import { useStudyBuddy } from "../features/chat/useStudyBuddy";

function Routes() {
  const route = useUi((st) => st.route);
  if (route.name === "space") return <SpaceScreen key={route.spaceId} spaceId={route.spaceId} />;
  if (route.name === "settings") return <SettingsScreen />;
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
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Tip.Provider>
        <Shell />
        <Toaster position="bottom-right" richColors closeButton theme="system" />
      </Tip.Provider>
    </QueryClientProvider>
  );
}
