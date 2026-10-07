import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function createSpace(app: Page, name: string) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill(name);
  await app.getByRole("button", { name: "Create" }).click();
  await expect(app.getByRole("banner").getByText(name)).toBeVisible();
}

async function paletteCommand(app: Page, command: string) {
  await app.getByRole("button", { name: "Search" }).click();
  await app.getByPlaceholder("Type a command or search…").fill(command);
  await app.keyboard.press("Enter");
}

test("quick capture from the palette saves a note into the current space", async ({ app }) => {
  await createSpace(app, "Biology");
  await paletteCommand(app, "Quick capture");

  const dialog = app.getByRole("dialog", { name: "Quick capture" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Space")).toHaveValue(/.+/);
  await expect(dialog.getByLabel("Space").locator("option:checked")).toHaveText("Biology");
  await dialog.getByRole("textbox", { name: "Quick capture" }).fill("Mitosis vs meiosis\nMitosis makes two identical cells.");
  await app.keyboard.press("ControlOrMeta+Enter");

  await expect(dialog).toBeHidden();
  await expect(app.getByText("Saved to Biology")).toBeVisible();
  await app.keyboard.press("ControlOrMeta+Shift+KeyS");
  const row = app.getByTestId("source-row").filter({ hasText: "Mitosis vs meiosis" });
  await expect(row).toHaveAttribute("data-status", "ready");
});

test("quick capture from home defaults to the last opened space and saves into the chosen one", async ({ app }) => {
  await createSpace(app, "Chemistry");
  await app.getByRole("button", { name: "Home" }).click();
  await createSpace(app, "History");
  await app.getByRole("button", { name: "Home" }).click();

  await paletteCommand(app, "Quick capture");
  const dialog = app.getByRole("dialog", { name: "Quick capture" });
  // last opened space is the default
  await expect(dialog.getByLabel("Space").locator("option:checked")).toHaveText("History");
  await app.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await paletteCommand(app, "Quick capture");
  await dialog.getByLabel("Space").selectOption({ label: "Chemistry" });
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Quick capture" }).fill("Avogadro's number is 6.022e23");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await paletteCommand(app, "Chemistry");
  await app.keyboard.press("ControlOrMeta+Shift+KeyS");
  await expect(app.getByTestId("source-row").filter({ hasText: "Avogadro's number" })).toHaveAttribute("data-status", "ready");
});

test("watched folders: add imports the folder's files, remove keeps the sources", async ({ app }) => {
  await createSpace(app, "Lectures");
  await app.keyboard.press("ControlOrMeta+Shift+KeyS");
  await app.getByTestId("watched-folders-entry").click();
  const dialog = app.getByRole("dialog", { name: "Watched folders" });
  await expect(dialog.getByText("No watched folders")).toBeVisible();

  await dialog.getByRole("button", { name: "Add folder" }).click();
  const folder = dialog.getByTestId("watched-folder");
  await expect(folder).toContainText("Lecture notes");
  await expect(folder).toContainText("/Users/me/Documents/Lecture notes");
  await expect(folder).toHaveAttribute("data-status", "watching");
  await expect(folder).toContainText("Watching · 2 files");

  // adding the same folder again is refused
  await dialog.getByRole("button", { name: "Add folder" }).click();
  await expect(app.getByText("This folder is already watched in this space.")).toBeVisible();

  await dialog.getByRole("button", { name: "Stop watching: Lecture notes" }).click();
  await app.getByRole("dialog", { name: "Stop watching this folder?" }).getByRole("button", { name: "Stop watching" }).click();
  await expect(dialog.getByText("No watched folders")).toBeVisible();
  await app.keyboard.press("Escape");

  const sources = app.getByTestId("source-list");
  await expect(sources.getByText("Lecture 1")).toBeVisible();
  await expect(sources.getByText("Week 2 notes")).toBeVisible();
  await expect(app.getByTestId("watched-folders-entry")).toBeVisible();
});

test("settings: change, reject and reset the quick capture shortcut", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("capture-settings");
  const shown = section.getByTestId("capture-shortcut");
  await expect(shown).toHaveText("⌥⌘N");

  await section.getByRole("button", { name: "Change" }).click();
  await expect(shown).toHaveText("Press the new shortcut…");
  await app.keyboard.press("Control+Shift+KeyK");
  await expect(shown).toHaveText("⌃⇧K");

  // a shortcut another app owns is refused and the old one stays
  await section.getByRole("button", { name: "Change" }).click();
  await app.keyboard.press("Meta+Space");
  await expect(app.getByText("Couldn't set the shortcut")).toBeVisible();
  await expect(shown).toHaveText("⌃⇧K");

  // shift alone isn't enough
  await section.getByRole("button", { name: "Change" }).click();
  await app.keyboard.press("Shift+KeyJ");
  await expect(shown).toHaveText("Press the new shortcut…");
  await app.keyboard.press("Escape");
  await expect(shown).toHaveText("⌃⇧K");

  await section.getByRole("button", { name: "Reset" }).click();
  await expect(shown).toHaveText("⌥⌘N");

  await section.getByRole("switch", { name: "Global shortcut" }).click();
  await expect(section.getByRole("switch", { name: "Global shortcut" })).toHaveAttribute("aria-checked", "false");
  await app.reload();
  await expect(app.getByTestId("capture-settings").getByRole("switch", { name: "Global shortcut" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
