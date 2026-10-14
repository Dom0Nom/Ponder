import { test, expect } from "./fixtures";

const NOTES = `Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.`;

async function setup(app: import("@playwright/test").Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Photosynthesis notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(NOTES);
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
}

async function ask(app: import("@playwright/test").Page, q: string, n: number) {
  const box = app.getByLabel("Ask about your sources…");
  await box.fill(q);
  await box.press("Enter");
  await expect(app.getByTestId("msg-assistant")).toHaveCount(n);
  await expect(app.getByTestId("msg-assistant").nth(n - 1)).not.toContainText("…", { timeout: 15_000 }).catch(() => {});
}

test("context meter shows what the model read and the source modes", async ({ app }) => {
  await setup(app);
  await ask(app, "Where does photosynthesis happen?", 1);
  const meter = app.getByTestId("context-meter");
  await expect(meter).toBeVisible();
  await meter.click();
  await expect(app.getByText("What the model sees")).toBeVisible();
  await expect(app.getByText(/passages? from your sources/)).toBeVisible();
  await app.keyboard.press("Escape");

  await app.getByTestId("source-row").hover();
  await app.getByRole("button", { name: "Source options" }).click();
  await app.getByRole("menuitemradio", { name: /Full text/ }).click();
  await ask(app, "And what does the Calvin cycle do?", 2);
  await app.getByTestId("context-meter").click();
  await expect(app.getByText("Full text:")).toBeVisible();
  await expect(app.getByText("Photosynthesis notes").last()).toBeVisible();
});

test("/compact in the composer says when there's nothing to compact", async ({ app }) => {
  await setup(app);
  await ask(app, "Where does photosynthesis happen?", 1);
  const box = app.getByLabel("Ask about your sources…");
  await box.fill("/compact keep the formulas");
  await box.press("Enter");
  await expect(app.getByText("Nothing to compact yet.")).toBeVisible();
  await expect(app.getByTestId("msg-user")).toHaveCount(1);
});
