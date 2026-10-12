import { test, expect } from "./fixtures";

test("sources panel: closed by default, opens after an import, rename, select all, delete", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Physics");
  await app.getByRole("button", { name: "Create" }).click();

  const panel = app.getByRole("region", { name: "Sources" });
  await expect(panel).toHaveCount(0);

  for (const title of ["Optics", "Waves"]) {
    await app.getByRole("button", { name: "Add source" }).first().click();
    await app.getByRole("tab", { name: "Paste text" }).click();
    await app.getByLabel("Title").fill(title);
    await app.getByRole("textbox", { name: "Text", exact: true }).fill(`${title} notes about light and sound.`);
    await app.getByRole("button", { name: "Import" }).click();
    await expect(panel).toBeVisible();
  }
  const rows = app.getByTestId("source-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Note");

  await app.keyboard.press("Meta+Shift+s");
  await expect(panel).toHaveCount(0);
  await app.keyboard.press("Meta+Shift+s");
  await expect(panel).toBeVisible();

  await rows.filter({ hasText: "Waves" }).hover();
  await rows.filter({ hasText: "Waves" }).getByRole("button", { name: "Source options" }).click();
  await app.getByRole("menuitem", { name: "Rename" }).click();
  await app.getByRole("textbox", { name: "Rename" }).fill("Sound waves");
  await app.getByRole("button", { name: "Save" }).click();
  await expect(rows.filter({ hasText: "Sound waves" })).toHaveCount(1);

  const all = panel.getByLabel("Select all sources");
  await expect(all).toBeChecked();
  await all.click();
  await expect(panel.getByLabel(/^Use in chat: Optics/)).not.toBeChecked();
  await all.click();
  await expect(panel.getByLabel(/^Use in chat: Optics/)).toBeChecked();

  await rows.filter({ hasText: "Optics" }).hover();
  await rows.filter({ hasText: "Optics" }).getByRole("button", { name: "Source options" }).click();
  await app.getByRole("menuitem", { name: "Delete" }).click();
  await app.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(rows).toHaveCount(1);
});

test("import dialog: one footer action per tab, chosen tab sets the width", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Chem");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).first().click();
  const dialog = app.getByRole("dialog", { name: "Add a source" });
  await expect(dialog.getByRole("button", { name: "Import" })).toBeEnabled();
  await dialog.getByRole("tab", { name: "Web page" }).click();
  await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
  await dialog.getByLabel("Web address").fill("https://example.com/a");
  await expect(dialog.getByRole("button", { name: "Import" })).toBeEnabled();
  const narrow = (await dialog.boundingBox())!.width;
  await dialog.getByRole("tab", { name: "Deep research" }).click();
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeGreaterThan(narrow);
  await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
});

test("settings: switching the search model re-indexes", async ({ app }) => {
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  const section = app.getByTestId("search-model-section");
  await section.scrollIntoViewIfNeeded();
  const select = section.getByLabel("Search model");
  await expect(select).toHaveValue("all-MiniLM-L6-v2");
  await expect(section.getByTestId("search-model-status")).toHaveText("Ready");
  await select.selectOption("multilingual-e5-small");
  await expect(app.getByText("Search model changed. Re-indexing in the background.")).toBeVisible();
  await expect(section).toContainText("Multilingual");
  await expect(section).toContainText("488 MB");
  await expect(section.getByTestId("search-model-status")).toHaveText("Ready", { timeout: 5000 });
  await expect(select).toHaveValue("multilingual-e5-small");
});
