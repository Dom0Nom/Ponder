import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

type MockWindow = Window & { __mock: { advance: (ms: number) => void } };

const advance = (app: Page, ms: number) => app.evaluate((n) => (window as unknown as MockWindow).__mock.advance(n), ms);

async function createSpace(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await expect(app.getByRole("button", { name: /^Flashcards/ })).toBeVisible();
}

async function startSession(app: Page, technique: RegExp, lowEnergy = false) {
  await app.keyboard.press("ControlOrMeta+Shift+KeyF");
  const dialog = app.getByRole("dialog", { name: "Start a focus session" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: technique }).click();
  if (lowEnergy) await dialog.getByRole("radio", { name: /Low energy/ }).click();
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(dialog).toBeHidden();
}

test("flowtime session posts a hyperfocus note and toast after 90 minutes", async ({ app }) => {
  await createSpace(app);
  await startSession(app, /^Flowtime/);
  await advance(app, 89 * 60_000);
  await expect(app.locator("[data-sonner-toast]")).toHaveCount(0);

  await advance(app, 2 * 60_000);
  const toast = app.locator("[data-sonner-toast]").filter({ hasText: "Time to move?" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/\d+ min of focus/);
  await expect(toast.getByRole("button", { name: "Take a break" })).toBeVisible();
  await expect(app.getByText(/\d+ min of focus\./).first()).toBeVisible();
  await expect(app.getByTestId("msg-buddy").filter({ hasText: /\d+ min of focus/ })).toHaveCount(1);
});

test("hyperfocus guard stays quiet when switched off in settings", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const guard = app.getByRole("switch", { name: "Hyperfocus guard" });
  await expect(guard).toBeChecked();
  await guard.click();
  await expect(guard).not.toBeChecked();
  await app.getByRole("button", { name: "Back" }).click();
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await startSession(app, /^Flowtime/);
  await advance(app, 95 * 60_000);
  await expect(app.getByText(/^\d+ min of focus\./)).toHaveCount(0);
  await expect(app.locator("[data-sonner-toast]").filter({ hasText: "Time to move?" })).toHaveCount(0);
});

test("low-energy session shows the review-only card and blocks new material", async ({ app }) => {
  await createSpace(app);
  await app.getByRole("button", { name: /^Flashcards/ }).click();
  await expect(app.getByRole("button", { name: "Make cards from sources" })).toBeEnabled();
  await app.getByRole("button", { name: "Back to Studio" }).click();
  await startSession(app, /^Pomodoro/, true);

  const card = app.getByTestId("low-energy-card");
  await expect(card).toBeVisible();
  await expect(app.getByRole("region", { name: "Studio" })).toContainText("Low-energy session");
  await expect(card.getByRole("button", { name: /Re-test mistakes/ })).toBeEnabled();
  await expect(card.getByRole("button", { name: /Review due cards/ })).toBeVisible();
  await app.getByRole("button", { name: "Back to Studio" }).click();
  await app.getByRole("button", { name: /^Flashcards/ }).click();
  await expect(app.getByRole("button", { name: "Make cards from sources" })).toBeDisabled();
  await expect(app.getByRole("button", { name: "Add card" })).toBeDisabled();
  await app.getByRole("button", { name: "Back to Studio" }).click();
  await app.keyboard.press("ControlOrMeta+Shift+KeyS");
  await expect(app.getByRole("button", { name: "Add source" })).toBeDisabled();

  await app.getByRole("button", { name: /^Low-energy session/ }).click();
  await card.getByRole("button", { name: /Re-test mistakes/ }).click();
  await expect(app.getByRole("tab", { name: "Mistake notebook", selected: true })).toBeVisible();
});
