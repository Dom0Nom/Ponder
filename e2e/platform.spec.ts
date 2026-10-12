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
  const exe = "/Applications/Ponder.app/Contents/MacOS/ponder";
  const db = "/Users/me/Library/Application Support/dev.ponder.app/app.db";
  await expect(section.getByTestId("mcp-claude-code")).toHaveText(`claude mcp add ponder -- ${exe} mcp --db '${db}'`);
  const cfg = JSON.parse((await section.getByTestId("mcp-claude-desktop").textContent()) ?? "");
  expect(cfg).toEqual({ mcpServers: { ponder: { command: exe, args: ["mcp", "--db", db] } } });
});

const TEXT = "Cells divide by mitosis. Mitochondria make energy for the cell.";

async function addTextSource(app: Page, title: string) {
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill(title);
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(TEXT);
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
}

async function paletteAction(app: Page, name: string) {
  await app.getByRole("button", { name: "Search" }).click();
  await app.getByPlaceholder("Type a command or search…").fill(name);
  await app.keyboard.press("Enter");
}

test("study packs: export a space, import it as a new space with its own sources", async ({ app }) => {
  test.setTimeout(120_000);
  await paletteAction(app, "Import study pack");
  await expect(app.getByText("Importing study pack…")).toHaveCount(0);
  await expect(app.getByTestId("space-grid")).toHaveCount(0);

  const bio = await createSpace(app, "Biology");
  await addTextSource(app, "Cells");
  await app.evaluate((id) => {
    const db = (window as any).__mock.db();
    db.notes = { n1: { id: "n1", spaceId: id, title: "Osmosis", body: "Water moves.", useAsSource: false, sourceId: null, createdAt: 1, updatedAt: 1 } };
    db.cards = { c1: { id: "c1", spaceId: id, kind: "basic", front: "Q", back: "A", data: null, sourceId: null, chunkStart: null, chunkEnd: null, origin: "manual", suspended: false, createdAt: 1, updatedAt: 1, due: 1, state: 2, fsrs: {}, spaceName: "Biology" } };
  }, bio);

  await paletteAction(app, "Export study pack");
  await expect(app.getByText("Study pack saved: 1 source, 1 card, 1 note")).toBeVisible();

  await paletteAction(app, "Import study pack");
  await expect(app.getByText(/Imported “Biology \(imported\)”/)).toBeVisible();
  await expect(app.getByRole("banner").getByText("Biology (imported)")).toBeVisible();
  await app.getByRole("button", { name: /^Sources/ }).first().click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
  await expect(app.getByTestId("source-row")).toContainText("Cells");

  const counts = await app.evaluate(() => {
    const db = (window as any).__mock.db();
    const spaces = Object.values(db.spaces) as any[];
    const imported = spaces.find((x) => x.name === "Biology (imported)");
    return {
      spaces: spaces.length,
      sources: Object.values(db.sources).filter((x: any) => x.spaceId === imported.id).length,
      notes: Object.values(db.notes).filter((x: any) => x.spaceId === imported.id).length,
      cards: Object.values(db.cards).filter((x: any) => x.spaceId === imported.id && x.state === 0).length,
      chunks: db.chunks.filter((c: any) => c.spaceId === imported.id).length > 0,
    };
  });
  expect(counts).toEqual({ spaces: 2, sources: 1, notes: 1, cards: 1, chunks: true });

  await app.getByRole("button", { name: "Home" }).click();
  await expect(app.getByTestId("space-card")).toHaveCount(2);
});

test("study packs: a damaged pack shows an error and adds nothing", async ({ app }) => {
  await createSpace(app, "Biology");
  await app.evaluate(() => {
    const db = (window as any).__mock.db();
    db.packs = { "/tmp/bad.ponderpack": { name: "Bad" } };
    db.lastPack = "/tmp/bad.ponderpack";
  });
  await paletteAction(app, "Import study pack");
  await expect(app.getByText("Couldn't import the study pack")).toBeVisible();
  await expect(app.getByText(/damaged/)).toBeVisible();
  const spaces = await app.evaluate(() => Object.keys((window as any).__mock.db().spaces).length);
  expect(spaces).toBe(1);
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
