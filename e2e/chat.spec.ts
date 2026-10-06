import { test, expect } from "./fixtures";

const NOTES = `Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.

Cellular respiration releases energy from glucose in the mitochondria.`;

test("create space → import source → chat with citation → open cited passage", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();

  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Photosynthesis notes");
  await app.getByLabel("Text").fill(NOTES);
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);

  const box = app.getByLabel("Ask about your sources…");
  await box.fill("Where does photosynthesis happen?");
  await box.press("Enter");

  await expect(app.getByTestId("msg-user")).toContainText("Where does photosynthesis happen?");
  const answer = app.getByTestId("msg-assistant");
  await expect(answer).toContainText("chloroplasts");
  await expect(answer.getByTestId("general-block")).toContainText("Not from your sources");
  await expect(answer.getByTestId("cited-sources")).toContainText("Photosynthesis notes");

  await answer.getByTestId("cite-chip").first().click();
  const viewer = app.getByTestId("source-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("cite-highlight")).toHaveText(
    "Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light energy.",
  );
  await expect(viewer.getByTestId("cite-highlight")).toBeInViewport();
});

test("chat without a configured model explains what to do", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: "New space" }).first().click();
  await page.getByLabel("Name").fill("Empty");
  await page.getByRole("button", { name: "Create" }).click();
  const box = page.getByLabel("Ask about your sources…");
  await box.fill("hello");
  await box.press("Enter");
  await expect(page.getByText("No chat model set up yet.")).toBeVisible();
  await expect(box).toHaveValue("hello");
});
