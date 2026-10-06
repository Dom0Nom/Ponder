import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

type MockWindow = Window & { __mock: { advance: (ms: number) => void } };

const NOTES = `Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.`;

async function startOneMinuteSession(app: Page) {
  await app.getByRole("button", { name: "Focus", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Start a focus session" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: /^Custom/ }).click();
  await dialog.getByLabel("Focus (min)", { exact: true }).fill("1");
  await dialog.getByLabel("Break (min)", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(dialog).toBeHidden();
}

async function openCitedPassage(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Photosynthesis notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(NOTES);
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
  const box = app.getByLabel("Ask about your sources…");
  await box.fill("Where does photosynthesis happen?");
  await box.press("Enter");
  await app.getByTestId("msg-assistant").getByTestId("cite-chip").first().click();
  const viewer = app.getByTestId("source-viewer");
  await expect(viewer.getByTestId("cite-highlight")).toBeVisible();
  return viewer;
}

test("break menu: edit in settings, pick on the break screen", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const add = app.getByRole("textbox", { name: "Add a break activity" });
  await add.fill("  Play guitar ");
  await add.press("Enter");
  await expect(app.getByRole("textbox", { name: "Activity 5" })).toHaveValue("Play guitar");

  await add.fill("play guitar");
  await add.press("Enter");
  await expect(app.getByText("That one is already on the list.")).toBeVisible();
  await expect(app.getByRole("textbox", { name: "Activity 6" })).toHaveCount(0);

  await app.getByRole("button", { name: "Remove “Look out of a window”" }).click();
  await expect(app.getByRole("textbox", { name: "Activity 5" })).toHaveCount(0);

  await app.getByRole("button", { name: "Move “Play guitar” up" }).click();
  await expect(app.getByRole("textbox", { name: "Activity 3" })).toHaveValue("Play guitar");

  await startOneMinuteSession(app);
  await app.evaluate(() => (window as unknown as MockWindow).__mock.advance(61_000));
  const overlay = app.getByRole("dialog", { name: "Break time" });
  await expect(overlay.getByText("Pick something for this break")).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Look out of a window" })).toHaveCount(0);
  await expect(overlay.getByText("Try this")).toHaveCount(0);

  await overlay.getByRole("button", { name: "Play guitar" }).focus();
  await app.keyboard.press("Enter");
  await expect(overlay.getByText("You picked: Play guitar")).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Play guitar" })).toHaveAttribute("aria-pressed", "true");

  await app.keyboard.press("Tab");
  await app.keyboard.press("Space");
  await expect(overlay.getByText(/^You picked: /)).not.toHaveText("You picked: Play guitar");
});

test("break screen shows a tip when the menu is empty", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  for (const name of ["Drink a glass of water", "Stretch or walk around", "Look out of a window", "Do ten slow breaths"]) {
    await app.getByRole("button", { name: `Remove “${name}”` }).click();
  }
  await expect(app.getByText(/^No activities/)).toBeVisible();
  await startOneMinuteSession(app);
  await app.evaluate(() => (window as unknown as MockWindow).__mock.advance(61_000));
  const overlay = app.getByRole("dialog", { name: "Break time" });
  await expect(overlay.getByText("Try this")).toBeVisible();
  await expect(overlay.getByText("Pick something for this break")).toHaveCount(0);
});

test("bionic reading bolds word starts and keeps the cited highlight", async ({ app }) => {
  const viewer = await openCitedPassage(app);
  const highlight = viewer.getByTestId("cite-highlight");
  const before = await highlight.textContent();
  await expect(viewer.locator("b")).toHaveCount(0);

  await viewer.getByRole("button", { name: "Bionic reading" }).click();
  await expect(viewer.getByRole("button", { name: "Bionic reading" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByTestId("source-text").locator("b").first()).toBeVisible();
  await expect(highlight.locator("b").first()).toHaveText("Photosy");
  await expect(highlight).toHaveText(before!);
  await expect(highlight).toBeInViewport();
  await expect(viewer.getByTestId("source-text")).toContainText("The Calvin cycle uses ATP and NADPH");

  await viewer.getByRole("button", { name: "Bionic reading" }).click();
  await expect(viewer.locator("b")).toHaveCount(0);
});

test("reading ruler follows the pointer and the settings switch stays in sync", async ({ app }) => {
  const viewer = await openCitedPassage(app);
  const ruler = viewer.getByTestId("reading-ruler");
  await expect(ruler).toHaveCount(0);

  await viewer.getByRole("button", { name: "Reading ruler" }).click();
  const text = await viewer.getByTestId("source-text").boundingBox();
  await app.mouse.move(text!.x + 40, text!.y + 40);
  await expect(ruler).toBeVisible();
  await app.mouse.move(2, 2);
  await expect(ruler).toHaveCount(0);

  await app.getByRole("button", { name: "Settings" }).click();
  await expect(app.getByRole("switch", { name: "Reading ruler" })).toBeChecked();
  await expect(app.getByRole("switch", { name: "Bionic reading" })).not.toBeChecked();
});
