import { test as base, expect, type Page } from "@playwright/test";

type W = Window & {
  __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
  __mock: { db: () => { sources: Record<string, { id: string; title: string }>; texts: Record<string, { text: string }> } };
};

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/?seed&openrouter");
    await page.waitForFunction(() => (window as unknown as W).__mock);
    await page.evaluate(() => (window as unknown as W).__TAURI_INTERNALS__.invoke("secret_set", { providerId: "mock-openrouter", value: "k" }));
    await use(page);
  },
});

test.use({ launchOptions: { args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone"] });

test("lecture capture: record, transcribe, record more, save as a source", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Record" }).click();
  const tab = app.getByTestId("lecture-tab");
  const dialog = app.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Save as source" })).toBeDisabled();

  await tab.getByTestId("lecture-start").click();
  await expect(tab).toHaveAttribute("data-state", "recording");
  await expect(dialog).toContainText(/Recording 0:0[1-9]/);
  await tab.getByTestId("lecture-stop").click();
  const lines = tab.getByTestId("lecture-transcript").locator("> div");
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toHaveAttribute("data-state", "done");
  await expect(lines.first()).toContainText("0:00Chloroplasts capture light energy.");

  await tab.getByRole("button", { name: "Record more" }).click();
  await expect(tab).toHaveAttribute("data-state", "recording");
  await app.waitForTimeout(1200);
  await tab.getByTestId("lecture-stop").click();
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1)).toHaveAttribute("data-state", "done");
  await expect(lines.nth(1)).not.toContainText("0:00");

  await tab.getByLabel("Title").fill("Lecture 3: light reactions");
  await dialog.getByRole("button", { name: "Save as source" }).click();
  await expect(dialog).toBeHidden();
  const text = () =>
    app.evaluate(() => {
      const db = (window as unknown as W).__mock.db();
      const src = Object.values(db.sources).find((x) => x.title === "Lecture 3: light reactions");
      return src ? (db.texts[src.id]?.text ?? "") : "";
    });
  await expect.poll(text).toMatch(/^\[0:00\] Chloroplasts capture light energy\.\n\n\[0:0[1-9]\] Chloroplasts capture light energy\.$/);
});

test("lecture capture survives a tab switch and warns before closing unsaved", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Record" }).click();
  const tab = app.getByTestId("lecture-tab");
  const dialog = app.getByRole("dialog");
  await tab.getByTestId("lecture-start").click();
  await expect(tab).toHaveAttribute("data-state", "recording");
  await app.getByRole("tab", { name: "Paste text" }).click();
  await expect(dialog.getByRole("button", { name: "Save as source" })).toHaveCount(0);
  await app.getByRole("tab", { name: "Record" }).click();
  await expect(tab).toHaveAttribute("data-state", "recording");
  await tab.getByTestId("lecture-stop").click();
  await expect(tab.getByTestId("lecture-transcript").locator("> div").first()).toHaveAttribute("data-state", "done");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toContainText("The recording isn't saved yet");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("podcast feed: pick an episode, import its transcript or transcribe the audio", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  const dialog = app.getByRole("dialog");
  const texts = () =>
    app.evaluate(() => {
      const db = (window as unknown as W).__mock.db();
      return Object.values(db.sources).map((x) => [x.title, db.texts[x.id]?.text]);
    });

  for (const [episode, expected] of [
    ["The Calvin cycle", "[0:01] Today: how the Calvin cycle fixes carbon dioxide into sugar. Rubisco is the enzyme that does it."],
    ["Light reactions", "[0:00] Chloroplasts capture light energy."],
  ]) {
    await app.getByRole("button", { name: "Add source" }).click();
    await app.getByRole("tab", { name: "Web page" }).click();
    await dialog.getByLabel(/address|link|URL/i).fill("https://plant-talk.example.com/feed");
    await dialog.getByRole("button", { name: "Import" }).click();
    const picker = dialog.getByTestId("podcast-picker");
    await expect(picker).toContainText("Plant Talk: 2 episodes");
    await expect(picker.getByRole("radio")).toHaveCount(2);
    await expect(picker.getByRole("radio").first()).toContainText("12 min · Transcript");
    await picker.getByRole("radio", { name: new RegExp(episode) }).click();
    if (episode === "Light reactions") await expect(picker).toContainText("no published transcript, so the audio is transcribed");
    await dialog.getByRole("button", { name: "Add episode" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(texts).toContainEqual([`Plant Talk: ${episode}`, expected]);
  }
});
