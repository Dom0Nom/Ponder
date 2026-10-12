import { test, expect } from "./fixtures";

test("backups: choose folder, back up, prune, restore needs a restart", async ({ app }) => {
  test.setTimeout(90_000);
  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("backup-settings");
  await expect(section).toContainText("No folder chosen");
  await expect(section).toContainText("No backups yet");
  await expect(section.getByRole("switch", { name: "Automatic backups" })).toBeDisabled();
  await expect(section.getByRole("button", { name: "Back up now" })).toBeDisabled();

  await section.getByRole("button", { name: "Choose…" }).click();
  await expect(section).toContainText("/Users/me/Backups/Ponder");
  await section.getByRole("switch", { name: "Automatic backups" }).click();
  await expect(section.getByRole("switch", { name: "Automatic backups" })).toBeChecked();
  await section.getByLabel("How often").selectOption("weekly");
  await section.getByLabel("Keep the last").selectOption("3");

  for (let i = 0; i < 4; i++) {
    await app.evaluate(() => ((window as any).__mock.db().clockOffset += 1500));
    await section.getByRole("button", { name: "Back up now" }).click();
    await expect(section.getByTestId("backup-list").locator("> div")).toHaveCount(Math.min(i + 1, 3));
  }

  await section.getByTestId("backup-list").getByRole("button", { name: "Restore…" }).first().click();
  const dialog = app.getByRole("dialog", { name: "Restore this backup?" });
  await expect(dialog).toContainText(".before-restore");
  await dialog.getByRole("button", { name: "Restore" }).click();
  const staged = section.getByTestId("backup-staged");
  await expect(staged).toContainText("Backup ready to restore");
  await staged.getByRole("button", { name: "Cancel restore" }).click();
  await expect(staged).toHaveCount(0);

  await section.getByTestId("backup-list").getByRole("button", { name: "Delete" }).first().click();
  await expect(section.getByTestId("backup-list").locator("> div")).toHaveCount(2);
});
