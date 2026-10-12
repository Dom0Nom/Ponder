import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function createSpace(app: Page, name: string) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill(name);
  await app.getByRole("button", { name: "Create" }).click();
  await expect(app.getByRole("banner").getByText(name)).toBeVisible();
  return app.evaluate(
    (n) => (Object.values((window as any).__mock.db().spaces) as { id: string; name: string }[]).find((x) => x.name === n)!.id,
    name,
  );
}

const sendLink = (app: Page, url: string) => app.evaluate((u) => (window as any).__mock.deepLink(u), url);

test("deep links: ask fills the composer unsent, import prefills, bad links toast", async ({ app }) => {
  test.setTimeout(90_000);
  const bio = await createSpace(app, "Biology");
  await app.getByRole("button", { name: "Home" }).click();
  const chem = await createSpace(app, "Chemistry");

  await sendLink(app, `ponder://ask?q=${encodeURIComponent("What is osmosis?")}&space=${bio}`);
  await expect(app.getByRole("banner").getByText("Biology")).toBeVisible();
  await expect(app.getByPlaceholder("Ask about your sources…")).toHaveValue("What is osmosis?");

  await sendLink(app, `ponder://import?url=${encodeURIComponent("https://example.com/article")}&space=${chem}`);
  const dialog = app.getByRole("dialog", { name: "Add a source" });
  await expect(dialog.getByLabel("Web address")).toHaveValue("https://example.com/article");
  await app.keyboard.press("Escape");
  await expect(app.getByRole("banner").getByText("Chemistry")).toBeVisible();

  await sendLink(app, `ponder://space/${bio}`);
  await expect(app.getByRole("banner").getByText("Biology")).toBeVisible();

  await sendLink(app, "ponder://wipe?all=1");
  await expect(app.getByText("Ponder doesn't know the link “ponder://wipe”.")).toBeVisible();
  await sendLink(app, "ponder://space/does-not-exist");
  await expect(app.getByText("That link points to a space you don't have.")).toBeVisible();
});

test("integrations: shows link examples and the CLI alias with the binary path", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("integrations");
  await expect(section).toContainText("ponder://space/<space id>");
  await expect(section.getByTestId("cli-alias")).toHaveText("alias ponder='/Applications/Ponder.app/Contents/MacOS/ponder'");
});

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
