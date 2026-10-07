import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "./ui";

describe("ui store", () => {
  beforeEach(() => {
    useUi.setState({ route: { name: "home" }, studioView: null, reduceMotion: false, visualEffects: true });
  });

  it("keeps the stored visual effects value when motion is reduced", () => {
    useUi.getState().setReduceMotion(true);
    expect(useUi.getState().visualEffects).toBe(true);
    useUi.getState().setReduceMotion(false);
    expect(useUi.getState().visualEffects).toBe(true);
  });

  it("resets studioView when leaving a space or switching spaces", () => {
    const ui = useUi.getState();
    ui.navigate({ name: "space", spaceId: "a" });
    ui.setStudioView("journal");
    ui.navigate({ name: "space", spaceId: "a" });
    expect(useUi.getState().studioView).toBe("journal");
    ui.navigate({ name: "space", spaceId: "b" });
    expect(useUi.getState().studioView).toBeNull();
    ui.setStudioView("calculator");
    ui.navigate({ name: "home" });
    expect(useUi.getState().studioView).toBeNull();
  });

  it("remembers where Settings was opened from", () => {
    const ui = useUi.getState();
    ui.navigate({ name: "space", spaceId: "a" });
    ui.navigate({ name: "settings" });
    ui.navigate({ name: "settings", section: "focus" });
    expect(useUi.getState().settingsReturn).toEqual({ name: "space", spaceId: "a" });
  });

  it("opens the sidebar when a chat title is renamed", () => {
    useUi.setState({ sidebarOpen: false });
    useUi.getState().setRenamingThread("t1");
    expect(useUi.getState().sidebarOpen).toBe(true);
  });
});
