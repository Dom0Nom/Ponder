import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function spaceWithSource(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Photosynthesis notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill("Photosynthesis happens in the chloroplasts. The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.");
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
}

test("explain it back: feedback, saved mistakes and a follow-up round", async ({ app }) => {
  await spaceWithSource(app);
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Explain it back" }).click();
  const panel = app.getByTestId("feynman-panel");
  await expect(panel).toBeVisible();

  await panel.getByTestId("feynman-suggestions").getByRole("button", { name: "Photosynthesis notes" }).click();
  await expect(panel.getByLabel("Topic")).toHaveValue("Photosynthesis notes");
  await panel.getByTestId("feynman-text").fill("Plants make sugar.");
  await expect(panel.getByTestId("feynman-check")).toBeDisabled();
  await expect(panel.getByText("Write at least 12 words")).toBeVisible();

  await panel.getByTestId("feynman-text").fill("Plants take light in their mitochondria and turn it into sugar. The sugar is made from water and the light energy itself.");
  await panel.getByTestId("feynman-check").click();
  const fb = panel.getByTestId("feynman-feedback");
  await expect(fb.getByTestId("feynman-clarity")).toHaveAttribute("data-value", "2");
  await expect(fb.getByTestId("feynman-gaps")).toContainText("Calvin cycle");
  await expect(fb.getByTestId("feynman-mistakes")).toContainText("chloroplasts");
  await expect(fb.getByTestId("feynman-jargon")).toHaveCount(0);
  await expect(app.getByText("Saved 1 mistake to review")).toBeVisible();
  const mistakes = await app.evaluate(() => Object.values((window as any).__mock.db().mistakes ?? {}) as any[]);
  expect(mistakes.map((m) => [m.origin, m.given])).toEqual([["Explain it back", "in their mitochondria"]]);

  await fb.getByTestId("feynman-answer").fill("The carbon comes from carbon dioxide in the air.");
  await fb.getByTestId("feynman-answer-send").click();
  await expect(fb.getByTestId("feynman-clarity")).toHaveAttribute("data-value", "4");
  await expect(fb).toContainText("from 2");
  await expect(fb).toContainText("Round 2");

  await panel.getByTestId("feynman-revise").click();
  await expect(panel.getByTestId("feynman-text")).toHaveValue(/mitochondria/);
});
