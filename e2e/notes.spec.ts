import { test, expect, type Page } from "./fixtures";

const TEXT = `Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.`;

async function newSpace(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
}

async function openNotes(app: Page) {
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Notes" }).click();
  await expect(app.getByTestId("notes-screen")).toBeVisible();
}

async function addSource(app: Page) {
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Photosynthesis notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(TEXT);
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
}

const notesDb = (app: Page) => app.evaluate(() => Object.values((window as any).__mock.db().notes ?? {}) as any[]);

async function newNote(app: Page, title: string, body: string) {
  await app.getByTestId("note-new").click();
  const t = app.getByTestId("note-title");
  await t.fill(title);
  await t.blur();
  await app.getByTestId("note-body").fill(body);
}

test("notes: create, autosave, rename, link with autocomplete, backlinks, delete", async ({ app }) => {
  await newSpace(app);
  await openNotes(app);
  await expect(app.getByTestId("notes-screen")).toContainText("No notes yet");

  await newNote(app, "Cells", "Cells are the unit of life.");
  await expect(app.getByTestId("note-status")).toHaveText("Saved");
  await expect.poll(async () => (await notesDb(app)).map((n) => n.title)).toEqual(["Cells"]);
  await expect.poll(async () => (await notesDb(app))[0].body).toBe("Cells are the unit of life.");

  await newNote(app, "Mitosis", "Part of the cell cycle, see ");
  const body = app.getByTestId("note-body");
  await body.pressSequentially("[[ce");
  const sugg = app.getByTestId("link-suggestions");
  await expect(sugg.getByRole("option")).toHaveCount(1);
  await expect(sugg.getByRole("option").first()).toHaveText("Cells");
  await app.keyboard.press("Enter");
  await expect(body).toHaveValue("Part of the cell cycle, see [[Cells]]");
  await expect(sugg).toHaveCount(0);
  await expect.poll(async () => (await notesDb(app)).find((n) => n.title === "Mitosis").body).toBe("Part of the cell cycle, see [[Cells]]");

  await app.getByTestId("notes-list").getByText("Cells").click();
  await expect(app.getByTestId("backlinks")).toContainText("Mitosis");
  await app.getByTestId("backlinks").getByRole("button", { name: "Mitosis" }).click();
  await expect(app.getByTestId("note-title")).toHaveValue("Mitosis");
  await expect(app.getByTestId("backlinks")).toContainText("No other note links here yet.");

  await app.getByRole("radio", { name: "Preview" }).click();
  await app.getByTestId("note-preview").getByRole("link", { name: "Cells" }).click();
  await expect(app.getByTestId("note-title")).toHaveValue("Cells");

  const t = app.getByTestId("note-title");
  await t.fill("Cell biology");
  await t.blur();
  await expect.poll(async () => (await notesDb(app)).find((n) => n.title === "Mitosis").body).toBe("Part of the cell cycle, see [[Cell biology]]");

  await app.getByRole("button", { name: "Delete note" }).click();
  await app.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(app.getByTestId("notes-list").locator("li")).toHaveCount(1);
  await expect.poll(async () => (await notesDb(app)).map((n) => n.title)).toEqual(["Mitosis"]);
  await app.getByTestId("notes-list").getByText("Mitosis").click();
  await expect(app.getByTestId("missing-links")).toContainText('Create "Cell biology"');
  await app.getByTestId("missing-links").getByRole("button").click();
  await expect(app.getByTestId("note-title")).toHaveValue("Cell biology");
});

test("notes: use as source keeps a searchable source in sync", async ({ app }) => {
  await newSpace(app);
  await openNotes(app);
  await newNote(app, "Cells", "Mitochondria make ATP in the cell.");
  await app.getByRole("switch", { name: "Use as source" }).click();
  await expect(app.getByTestId("note-source-status")).toHaveText("In chat sources", { timeout: 10_000 });
  const sources = () => app.evaluate(() => Object.values((window as any).__mock.db().sources) as any[]);
  expect((await sources()).map((x) => [x.title, x.origin?.startsWith("note:")])).toEqual([["Cells", true]]);

  await app.getByTestId("note-body").fill("The nucleus holds the DNA.");
  await expect.poll(async () => (await app.evaluate(() => (window as any).__mock.db().chunks)).map((c: any) => c.text)).toEqual(["The nucleus holds the DNA."]);
  expect((await sources()).length).toBe(1);

  await app.getByTestId("note-title").fill("Cell parts");
  await app.getByTestId("note-title").blur();
  await expect.poll(async () => (await sources())[0].title).toBe("Cell parts");

  await app.getByRole("switch", { name: "Use as source" }).click();
  await expect.poll(async () => (await sources()).length).toBe(0);
  await expect.poll(async () => (await notesDb(app))[0].sourceId).toBeNull();
});

test("notes: cloze cards from a selection and from the whole note", async ({ app }) => {
  await newSpace(app);
  await openNotes(app);
  await newNote(app, "Cells", "Mitochondria make ATP in the cell. The nucleus holds the DNA.");
  const body = app.getByTestId("note-body");
  await body.evaluate((el: HTMLTextAreaElement) => {
    const i = el.value.indexOf("ATP");
    el.focus();
    el.setSelectionRange(i, i + 3);
  });
  await app.getByTestId("note-cloze").click();
  const dialog = app.getByRole("dialog");
  await expect(dialog.getByRole("textbox").first()).toHaveValue("Mitochondria make {{c1::ATP}} in the cell.");
  await dialog.getByRole("button", { name: "Add card" }).click();
  await expect.poll(async () => app.evaluate(() => Object.values((window as any).__mock.db().cards).length)).toBe(1);

  await body.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await app.getByTestId("note-cloze").click();
  await expect(app.getByText("Added 1 cloze card")).toBeVisible();
  const kinds = await app.evaluate(() => Object.values((window as any).__mock.db().cards).map((c: any) => c.kind));
  expect(kinds).toEqual(["cloze", "cloze"]);
});

test("notes: glossary is generated, cached and marked stale after edits", async ({ app }) => {
  await newSpace(app);
  await openNotes(app);
  await newNote(app, "Plants", "Photosynthesis uses chlorophyll to absorb light in the chloroplasts.");
  const g = app.getByTestId("glossary");
  await expect(g).toContainText("No glossary yet");
  await g.getByTestId("glossary-make").click();
  await expect(g.getByTestId("glossary-entry")).toHaveCount(3);
  await expect(g).toContainText("Chlorophyll");
  await expect.poll(() => app.evaluate(() => Object.keys((window as any).__mock.db().glossaries ?? {}).length)).toBe(1);
  await app.getByTestId("note-body").pressSequentially(" More text.");
  await expect(g).toContainText("The text changed since this glossary was made.");
  await app.reload();
  await app.getByTestId("note-body").waitFor();
  await expect(app.getByTestId("glossary").getByTestId("glossary-entry")).toHaveCount(3);
});

test("source viewer: glossary, reading level and side-by-side translation", async ({ app }) => {
  await newSpace(app);
  await addSource(app);
  await app.getByTestId("source-row").getByRole("button", { name: /Photosynthesis notes/ }).click();
  const viewer = app.getByTestId("source-viewer");
  await expect(viewer.getByTestId("source-text")).toContainText("Calvin cycle");
  await expect(viewer.getByTestId("reading-tools-toggle")).toHaveCSS("opacity", "0");
  await viewer.hover();
  await expect(viewer.getByTestId("reading-tools-toggle")).toHaveCSS("opacity", "1");
  await viewer.getByTestId("reading-tools-toggle").click();

  await viewer.getByTestId("glossary-make").click();
  await expect(viewer.getByTestId("glossary-entry").first()).toBeVisible();
  await expect(viewer.getByTestId("glossary")).toContainText("Calvin cycle");

  await viewer.getByRole("radio", { name: "Simpler" }).click();
  const passages = viewer.getByTestId("passages");
  await expect(passages.getByTestId("passage-main").first()).toContainText("In simple words: Photosynthesis happens");
  await expect.poll(() => app.evaluate(() => ((window as any).__mock.db().rewrites ?? []).length)).toBeGreaterThan(0);
  await viewer.getByRole("radio", { name: "Original" }).click();
  await expect(viewer.getByTestId("source-text")).toContainText("Calvin cycle");

  await viewer.getByTestId("translate-select").selectOption("German");
  const first = viewer.getByTestId("passage").first();
  await expect(first.getByTestId("passage-main")).toContainText("Photosynthesis happens");
  await expect(first.getByTestId("passage-translation")).toContainText("[German] Photosynthesis happens");
  const rewrites = await app.evaluate(() => (window as any).__mock.db().rewrites.map((r: any) => r.kind));
  expect(rewrites).toContain("lang:German");

  await viewer.getByTestId("translate-select").selectOption("");
  await expect(viewer.getByTestId("source-text")).toBeVisible();
  await viewer.getByRole("radio", { name: "Simpler" }).click();
  await expect(passages.getByTestId("passage-main").first()).toContainText("In simple words");
  const count = await app.evaluate(() => (window as any).__mock.db().rewrites.length);
  expect(count).toBeGreaterThan(0);
});
