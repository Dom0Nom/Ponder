import { test, expect, type Page } from "./fixtures";

type MockWindow = Window & {
  __mock: { db: () => { settings: Record<string, unknown> }; emit: (e: string, p: unknown) => void };
  __audio: string[];
};

async function startFocus(page: Page) {
  await page.keyboard.press("ControlOrMeta+Shift+KeyF");
  const dialog = page.getByRole("dialog", { name: "Start a focus session" });
  await dialog.getByRole("radio", { name: /^Custom/ }).click();
  await dialog.getByLabel("Focus (min)", { exact: true }).fill("1");
  await dialog.getByLabel("Break (min)", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(dialog).toBeHidden();
}

test("distraction nudge: pick apps from the open ones, set the grace time, show the nudge", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("distraction-settings");
  await section.getByRole("switch", { name: "Distraction nudge" }).click();
  await expect(section).toContainText("No apps chosen yet.");

  await section.getByTestId("distraction-add").click();
  await app.getByRole("menuitem", { name: "Safari" }).click();
  await section.getByTestId("distraction-add").click();
  await expect(app.getByRole("menuitem", { name: "Safari" })).toHaveCount(0);
  await app.getByRole("menuitem", { name: "Discord" }).click();
  await expect(section.getByTestId("distraction-apps").locator("li")).toHaveText(["Discord", "Safari"]);

  await section.getByRole("radio", { name: "30 s" }).click();
  await section.getByRole("button", { name: "Remove Safari" }).click();
  await expect(section.getByTestId("distraction-apps").locator("li")).toHaveText(["Discord"]);
  await expect
    .poll(() => app.evaluate(() => (window as unknown as MockWindow).__mock.db().settings["focus.distraction"]))
    .toEqual({ enabled: true, apps: [{ id: "com.hnc.Discord", name: "Discord" }], graceSec: 30 });

  await app.evaluate(() =>
    (window as unknown as MockWindow).__mock.emit("focus://distraction", {
      app: { id: "com.hnc.Discord", name: "Discord" },
      sessionId: "s1",
      remainingMs: 12 * 60_000,
      count: 1,
      at: Date.now(),
    }),
  );
  await expect(app.getByText("Discord is open during your focus block. 12 min left. Back to it?")).toBeVisible();
});

test("background sound plays during work blocks only", async ({ app }) => {
  await app.addInitScript(() => {
    const w = window as unknown as MockWindow;
    w.__audio = [];
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...a: Parameters<typeof start>) {
      w.__audio.push(`start ${this.buffer?.numberOfChannels}ch ${Math.round(this.buffer?.duration ?? 0)}s`);
      return start.apply(this, a);
    };
    AudioBufferSourceNode.prototype.stop = function (...a: Parameters<typeof stop>) {
      w.__audio.push("stop");
      return stop.apply(this, a);
    };
  });
  await app.reload();
  const audio = () => app.evaluate(() => (window as unknown as MockWindow).__audio);

  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("ambient-settings");
  await expect(section.getByRole("slider")).toHaveCount(0);
  await section.getByRole("radio", { name: "Rain" }).click();
  await expect(section.getByRole("slider", { name: "Volume" })).toBeVisible();
  await section.getByTestId("ambient-preview").click();
  await expect.poll(audio).toEqual(["start 2ch 8s"]);
  await section.getByTestId("ambient-preview").click();
  await expect.poll(audio).toEqual(["start 2ch 8s", "stop"]);
  await expect
    .poll(() => app.evaluate(() => (window as unknown as MockWindow).__mock.db().settings["focus.ambient"]))
    .toEqual({ sound: "rain", volume: 0.4 });

  await startFocus(app);
  await expect.poll(audio).toEqual(["start 2ch 8s", "stop", "start 2ch 8s"]);
  await app.evaluate(() => (window as unknown as { __mock: { advance: (ms: number) => void } }).__mock.advance(61_000));
  await expect.poll(audio).toEqual(["start 2ch 8s", "stop", "start 2ch 8s", "stop"]);
});
