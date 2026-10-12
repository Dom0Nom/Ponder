import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

type W = {
  __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
  __mock: { db: () => { threads: Record<string, { spaceId: string; title: string }>; messages: Record<string, { threadId: string; role: string; content: string; citations: unknown[] | null }>; sources: Record<string, { title: string; kind: string; spaceId: string; origin: string | null }> } };
  __askOpened?: { spaceId: string; threadId: string; sourceId: string | null }[];
  __snipCancel?: boolean;
};

const NOTES = `Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.`;

/** Biology (with a source) and History, History opened last unless `last` says otherwise. */
async function seed(app: Page, last: "Biology" | "History" = "Biology") {
  await app.waitForFunction(() => !!(window as unknown as { __mock?: unknown }).__mock);
  await app.evaluate(
    async ({ notes, last }) => {
      const inv = (window as unknown as W).__TAURI_INTERNALS__.invoke;
      const bio = (await inv("create_space", { input: { name: "Biology" } })) as { id: string };
      const his = (await inv("create_space", { input: { name: "History" } })) as { id: string };
      await inv("import_text", { spaceId: bio.id, title: "Photosynthesis notes", text: notes, kind: "text", origin: null });
      await new Promise((r) => setTimeout(r, 600));
      await inv("touch_space", { id: last === "Biology" ? bio.id : his.id });
    },
    { notes: NOTES, last },
  );
}

async function openOverlay(app: Page, query = "") {
  await app.goto(`/?window=ask&seed${query}`);
  await expect(app.getByLabel("Ask anything", { exact: true })).toBeFocused({ timeout: 20_000 });
}

const dbOf = (app: Page) => app.evaluate(() => (window as unknown as W).__mock.db());

test("overlay defaults to the last opened space and streams a cited answer", async ({ app }) => {
  await seed(app);
  await openOverlay(app);
  await expect(app.getByLabel("Space").locator("option:checked")).toHaveText("Biology");
  await expect(app.getByText("Answers come from the sources in the chosen space.")).toBeVisible();

  await app.evaluate(() => (window as unknown as { __mock: { setStreamDelay: (n: number) => void } }).__mock.setStreamDelay(60));
  const box = app.getByLabel("Ask anything", { exact: true });
  await box.fill("Where does photosynthesis happen?");
  await box.press("Enter");

  await expect(app.getByRole("button", { name: "Stop" })).toBeVisible();
  const answer = app.getByTestId("ask-answer");
  await expect(answer).toContainText("chloroplasts");
  await expect(app.getByRole("button", { name: "Stop" })).toBeHidden();
  await expect(answer.getByTestId("general-block")).toContainText("Not from your sources");
  await expect(answer.getByTestId("cite-chip").first()).toContainText("Photosynthesis notes");
  // nothing is written to a thread until "Open in Ponder"
  expect(Object.keys((await dbOf(app)).threads)).toHaveLength(0);
});

test("overlay picks the most recently opened space", async ({ app }) => {
  await seed(app, "History");
  await openOverlay(app);
  await expect(app.getByLabel("Space").locator("option:checked")).toHaveText("History");
  await app.getByLabel("Space").selectOption({ label: "Biology" });
  await expect(app.getByLabel("Space").locator("option:checked")).toHaveText("Biology");
});

test("Open in Ponder saves the exchange as a thread and hands it to the main window", async ({ app }) => {
  await seed(app);
  await openOverlay(app);
  const box = app.getByLabel("Ask anything", { exact: true });
  await box.fill("Where does photosynthesis happen?");
  await box.press("Enter");
  await expect(app.getByTestId("ask-answer").getByTestId("cite-chip").first()).toBeVisible();
  await expect(app.getByRole("button", { name: "Copy" })).toBeVisible();

  await app.getByRole("button", { name: "Open in Ponder" }).click();
  await expect.poll(async () => (await app.evaluate(() => (window as unknown as W).__askOpened ?? [])).length).toBe(1);

  const db = await dbOf(app);
  const threads = Object.entries(db.threads);
  expect(threads).toHaveLength(1);
  const [threadId, thread] = threads[0];
  expect(thread.title).toBe("Where does photosynthesis happen?");
  const msgs = Object.values(db.messages)
    .filter((m) => m.threadId === threadId)
    .sort((a, b) => (a.role === "user" ? -1 : 1) - (b.role === "user" ? -1 : 1));
  expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(msgs[0].content).toBe("Where does photosynthesis happen?");
  expect(msgs[1].content).toContain("chloroplasts");
  expect(msgs[1].citations?.length).toBeGreaterThan(0);
  const opened = await app.evaluate(() => (window as unknown as W).__askOpened ?? []);
  expect(opened[0]).toMatchObject({ threadId, spaceId: thread.spaceId, sourceId: null });
});

test("clicking a citation opens the thread with that source", async ({ app }) => {
  await seed(app);
  await openOverlay(app);
  const box = app.getByLabel("Ask anything", { exact: true });
  await box.fill("Where does photosynthesis happen?");
  await box.press("Enter");
  await app.getByTestId("ask-answer").getByTestId("cite-chip").first().click();
  await expect.poll(async () => (await app.evaluate(() => (window as unknown as W).__askOpened ?? [])).length).toBe(1);
  const opened = await app.evaluate(() => (window as unknown as W).__askOpened ?? []);
  expect(opened[0].sourceId).toBeTruthy();
});

test("snip attaches a screenshot to the question and the model sees it", async ({ app }) => {
  await seed(app);
  await openOverlay(app);
  await app.getByRole("button", { name: "Snip screen" }).click();
  await expect(app.getByAltText("Screenshot attached to your question")).toBeVisible();

  const box = app.getByLabel("Ask anything", { exact: true });
  await box.fill("What is this?");
  await box.press("Enter");
  await expect(app.getByTestId("ask-answer")).toContainText("labelled plant cell");
  await expect(app.getByTestId("ask-answer").getByTestId("cite-chip").first()).toBeVisible();
});

test("a snip alone can be asked with the default question", async ({ app }) => {
  await seed(app);
  await openOverlay(app);
  await app.getByRole("button", { name: "Snip screen" }).click();
  await app.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(app.getByTestId("ask-answer")).toContainText("labelled plant cell");
});

test("snip then Save as source adds a text source named after the first line", async ({ app }) => {
  await seed(app);
  await openOverlay(app);
  await app.getByRole("button", { name: "Snip screen" }).click();
  await app.getByRole("button", { name: "Save as source" }).click();
  await expect(app.getByTestId("ask-source-saved")).toHaveText("Saved to Biology");
  await expect(app.getByAltText("Screenshot attached to your question")).toBeHidden();

  await expect
    .poll(async () => Object.values((await dbOf(app)).sources).find((x) => x.title === "Plant cell diagram")?.kind)
    .toBe("text");
  const src = Object.values((await dbOf(app)).sources).find((x) => x.title === "Plant cell diagram");
  expect(src?.origin).toBe("screen-snip");
});

test("cancelling the region select does nothing", async ({ app }) => {
  await seed(app);
  await openOverlay(app);
  await app.evaluate(() => ((window as unknown as W).__snipCancel = true));
  await app.getByRole("button", { name: "Snip screen" }).click();
  await expect(app.getByRole("button", { name: "Snip screen" })).toBeEnabled();
  await expect(app.getByAltText("Screenshot attached to your question")).toBeHidden();
  await expect(app.getByTestId("ask-notice")).toBeHidden();
});

test("overlay without spaces says what to do", async ({ app }) => {
  await app.goto("/?window=ask&seed");
  await expect(app.getByText("Create a space in Ponder first, then ask from here.")).toBeVisible();
  await expect(app.getByLabel("Ask anything", { exact: true })).toBeDisabled();
});

test("overlay shows an error when the model call fails", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await seed(page);
  await page.goto("/?window=ask");
  const box = page.getByLabel("Ask anything", { exact: true });
  await box.fill("hello");
  await box.press("Enter");
  await expect(page.getByTestId("ask-error")).toContainText("Couldn't answer");
});

test("settings: change the ask shortcut, reject a clash with quick capture, enable the snip shortcut", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("ask-settings");
  const shown = section.getByTestId("ask-shortcut");
  await expect(shown).toHaveText("⌥⌘A");
  await expect(section.getByTestId("snip-shortcut")).toHaveText("⌥⌘S");
  await expect(section.getByRole("switch", { name: "Snip shortcut" })).toHaveAttribute("aria-checked", "false");

  await section.getByRole("button", { name: "Change" }).first().click();
  await expect(shown).toHaveText("Press the new shortcut…");
  await app.keyboard.press("Control+Shift+KeyK");
  await expect(shown).toHaveText("⌃⇧K");

  await section.getByRole("button", { name: "Change" }).first().click();
  await app.keyboard.press("Alt+Meta+KeyN");
  await expect(app.getByText("Couldn't set the shortcut")).toBeVisible();
  await expect(shown).toHaveText("⌃⇧K");

  await section.getByRole("button", { name: "Reset" }).click();
  await expect(shown).toHaveText("⌥⌘A");

  await section.getByRole("switch", { name: "Snip shortcut" }).click();
  await expect(section.getByRole("switch", { name: "Snip shortcut" })).toHaveAttribute("aria-checked", "true");
  await app.reload();
  await expect(app.getByTestId("ask-settings").getByRole("switch", { name: "Snip shortcut" })).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
});
