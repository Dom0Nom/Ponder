import { useEffect } from "react";
import { events } from "../lib/ipc";
import { startTour } from "../features/onboarding/startTour";

export function useHelpMenu() {
  useEffect(() => {
    const un = events.helpTour(() => void startTour());
    return () => void un.then((f) => f()).catch(() => {});
  }, []);
}
