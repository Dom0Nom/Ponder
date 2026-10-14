import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { toast, toastError } from "../../components/ui/toast";
import { useUi } from "../../stores/ui";

/** Opens the coach marks on the current space, or on the most recent one. */
export async function startTour() {
  const ui = useUi.getState();
  try {
    if (ui.route.name !== "space") {
      const spaces = await api.listSpaces();
      const latest = [...spaces].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
      if (!latest) return void toast(s.onboarding.tour.needSpace);
      ui.navigate({ name: "space", spaceId: latest.id });
    }
    setTimeout(() => useUi.getState().setTourOpen(true), 400);
  } catch (e) {
    toastError(s.errors.generic, e);
  }
}
