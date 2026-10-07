import { test, expect } from "./fixtures";

test("set up Google Drive, connect, browse a folder and import a PDF", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const card = app.getByRole("listitem", { name: "Google Drive" });
  await expect(card.getByText("Not set up")).toBeVisible();
  await card.getByRole("button", { name: "Connect" }).click();
  await card.getByLabel("Client ID").fill("1234-abc.apps.googleusercontent.com");
  await card.getByLabel("Client secret").fill("GOCSPX-mock");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Not connected")).toBeVisible();
  await card.getByRole("button", { name: "Connect" }).click();
  await expect(card.getByText("Connected as you@example.com")).toBeVisible();

  await app.getByRole("button", { name: "Back" }).click();
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();

  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Google Drive" }).click();
  const browser = app.getByTestId("cloud-browser-google");
  await expect(browser.getByText("Syllabus.pdf")).toBeVisible();
  await expect(browser.getByText("Whiteboard.jpg · Can't be imported")).toBeVisible();
  await expect(browser.getByLabel("Select Whiteboard.jpg")).toHaveCount(0);

  await browser.getByRole("button", { name: "Biology" }).click();
  await expect(browser.getByRole("navigation", { name: "Folder path" })).toContainText("My Drive/Biology");
  await browser.getByLabel("Select Photosynthesis.pdf").check();
  const dlg = app.getByRole("dialog");
  await expect(dlg.getByText("1 file selected")).toBeVisible();
  await dlg.getByRole("button", { name: "Import", exact: true }).click();

  const row = app.locator('[data-testid="source-row"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Photosynthesis");
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
  const origin = await app.evaluate(() => {
    const db = (window as unknown as { __mock: { db: () => { sources: Record<string, { origin: string }> } } }).__mock.db();
    return Object.values(db.sources).map((s) => s.origin);
  });
  expect(origin).toEqual(["gdrive://g-photosynthesis"]);
});

test("cloud tab explains missing setup and links to Settings", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Notes");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Dropbox" }).click();
  await expect(app.getByText("Add a Dropbox app key in Settings first.")).toBeVisible();
  await app.getByRole("button", { name: "Open Settings" }).click();
  await app.getByRole("listitem", { name: "Dropbox" }).getByRole("button", { name: "Connect" }).click();
  await expect(app.getByRole("listitem", { name: "Dropbox" }).getByLabel("App key")).toBeVisible();
});
