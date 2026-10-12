import { test, expect, type Page } from "./fixtures";

const NOTES = `Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.`;

async function spaceWithSource(app: Page) {
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

const exports = (app: Page) => app.evaluate(() => (window as any).__mock.db().exports ?? []);

test("studio outputs: worksheet with answer key, export, print, list, delete", async ({ app }) => {
  await spaceWithSource(app);
  await app.getByTestId("create-row").click();
  const panel = app.getByTestId("create-panel");
  await expect(panel).toContainText("Nothing made yet");
  await panel.getByLabel("Topic").fill("light reactions");
  await panel.locator('[data-kind="worksheet"]').click();

  const screen = app.getByTestId("output-screen");
  await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Photosynthesis worksheet");
  await expect(screen).toContainText("About: light reactions");
  await expect(screen.getByTestId("worksheet-questions").locator("> li")).toHaveCount(4);
  await expect(screen.getByTestId("answer-key")).toHaveCount(0);
  await screen.getByTestId("toggle-key").click();
  await expect(screen.getByTestId("answer-key")).toContainText("ATP and NADPH");

  await screen.getByTestId("output-export").click();
  await app.getByRole("menuitem", { name: "Markdown (.md)" }).click();
  await expect(app.getByText("Saved to /Users/me/Downloads/Photosynthesis worksheet.md")).toBeVisible();
  expect(await exports(app)).toEqual([{ name: "Photosynthesis worksheet", extension: "md", size: expect.any(Number) }]);

  await screen.getByTestId("output-export").click();
  await app.getByRole("menuitem", { name: "Print or save as PDF" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__mock.db().prints)).toBe(1);

  await screen.getByRole("button", { name: "Back to Biology" }).click();
  await expect(panel.getByTestId("outputs-list")).toContainText("Photosynthesis worksheet");
  await panel.getByTestId("outputs-list").getByText("Photosynthesis worksheet").click();
  await screen.getByRole("button", { name: "Delete" }).click();
  await app.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(panel).toContainText("Nothing made yet");
});

test("studio outputs: every kind renders and exports its main format", async ({ app }) => {
  await spaceWithSource(app);
  await app.getByTestId("create-row").click();
  const panel = app.getByTestId("create-panel");
  const screen = app.getByTestId("output-screen");
  const cases: [string, string, string | null][] = [
    ["report", "How photosynthesis works", "Markdown (.md)"],
    ["cheatsheet", "Photosynthesis cheat sheet", "Markdown (.md)"],
    ["timeline", "Discovering photosynthesis", "CSV (.csv)"],
    ["table", "Light reactions vs Calvin cycle", "Excel (.xlsx)"],
    ["mindmap", "Photosynthesis map", "Image (.svg)"],
    ["diagram", "Photosynthesis flow", "Image (.svg)"],
    ["slides", "Photosynthesis in 5 slides", "PowerPoint (.pptx)"],
    ["infographic", "Photosynthesis at a glance", "Image (.png)"],
  ];
  for (const [kind, title, format] of cases) {
    await panel.locator(`[data-kind="${kind}"]`).click();
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(screen.getByTestId("output")).toHaveAttribute("data-kind", kind);
    if (kind === "report") await expect(screen).toContainText("[1] Photosynthesis notes");
    if (kind === "table") await expect(screen.getByRole("columnheader", { name: "Location" })).toBeVisible();
    if (kind === "diagram") await expect(screen.getByTestId("diagram").locator("svg")).toBeVisible({ timeout: 20_000 });
    if (kind === "slides") {
      await expect(screen.getByTestId("slide-counter")).toHaveText("Slide 1 of 4");
      await app.keyboard.press("ArrowRight");
      await expect(screen.getByTestId("slide-counter")).toHaveText("Slide 2 of 4");
    }
    if (format) {
      const before = (await exports(app)).length;
      await screen.getByTestId("output-export").click();
      await app.getByRole("menuitem", { name: format }).click();
      await expect.poll(async () => (await exports(app)).length).toBe(before + 1);
      const last = (await exports(app)).at(-1);
      expect(last.size).toBeGreaterThan(50);
    }
    await screen.getByRole("button", { name: "Back to Biology" }).click();
  }
  await expect(panel.getByTestId("outputs-list").locator("li")).toHaveCount(cases.length);
});

test("studio outputs: diagram code is editable and invalid code shows an error", async ({ app }) => {
  await spaceWithSource(app);
  await app.getByTestId("create-row").click();
  await app.getByTestId("create-panel").locator('[data-kind="diagram"]').click();
  const screen = app.getByTestId("output-screen");
  await expect(screen.getByTestId("diagram").locator("svg")).toBeVisible({ timeout: 20_000 });
  await screen.getByRole("button", { name: "Edit code" }).click();
  const code = screen.getByTestId("diagram-code");
  await code.fill("flowchart TD\n  A[Start] --> B[Finish]");
  await expect(screen.getByTestId("diagram")).toContainText("Finish");
  await code.fill("flowchart TD\n  A[Start --> ");
  await expect(screen.getByRole("alert")).toContainText("The diagram has an error");
  await code.fill("flowchart TD\n  A[Start] --> C[Saved]");
  await expect(screen.getByTestId("diagram")).toContainText("Saved");
  await expect
    .poll(() => app.evaluate(() => Object.values((window as any).__mock.db().outputs).map((o: any) => o.data.code)[0]))
    .toBe("flowchart TD\n  A[Start] --> C[Saved]");
});

test("studio outputs: a space without ready sources explains why", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Empty");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Create a report, slides, mind map…" }).click();
  await app.getByTestId("create-panel").locator('[data-kind="report"]').click();
  await expect(app.getByTestId("create-panel")).toContainText("Add a source that has finished processing first");
});
