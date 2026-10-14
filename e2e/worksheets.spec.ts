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

const exportsOf = (app: Page) => app.evaluate(() => (window as any).__mock.db().exports ?? []);

async function openBuilder(app: Page) {
  await app.getByTestId("create-row").click();
  await app.getByTestId("create-worksheet").click();
  await expect(app.getByTestId("worksheet-builder")).toBeVisible();
}

test("worksheet: create, fill in, grade with partial credit and open answers, export markdown", async ({ app }) => {
  await spaceWithSource(app);
  await openBuilder(app);
  await expect(app.getByTestId("worksheets-list")).toHaveCount(0);
  await app.getByTestId("ws-topic").fill("light reactions");
  await app.getByTestId("ws-generate").click();

  const screen = app.getByTestId("worksheet-screen");
  await expect(screen.getByTestId("worksheet-title")).toHaveText("Photosynthesis worksheet");
  const tasks = screen.getByTestId("worksheet-task");
  await expect(tasks).toHaveCount(4);
  await expect(tasks.nth(0)).toContainText("Task 1: Multiple choice");
  await expect(tasks.nth(0)).toContainText("4 Points");

  const mc = tasks.nth(0).getByRole("radiogroup", { name: "Where does photosynthesis happen?" });
  await mc.getByRole("radio", { name: /Chloroplast/ }).click();
  const multi = tasks.nth(0).getByTestId("multi-options");
  await multi.getByLabel(/Oxygen/).check();
  await multi.getByLabel(/Nitrogen/).check();

  await tasks.nth(1).getByRole("radiogroup", { name: "Oxygen comes from split water." }).getByRole("radio", { name: "True" }).click();
  await tasks.nth(1).getByRole("radiogroup", { name: "Plants need no light." }).getByRole("radio", { name: "True" }).click();

  await tasks.nth(2).getByTestId("gap-input").fill("CO2");
  await tasks.nth(3).getByRole("textbox").fill("Light splits water and makes oxygen.");

  await screen.getByTestId("worksheet-check").click();
  const result = screen.getByTestId("worksheet-result");
  await expect(result).toBeVisible();
  // task 1: mc right (2) + multi 1 right, 1 wrong => 0 (2 -> 0); task 2: one of two (1); task 3: 2; open: 3 of 4
  await expect(tasks.nth(0).getByTestId("task-points")).toHaveText("2 / 4");
  await expect(tasks.nth(1).getByTestId("task-points")).toHaveText("1 / 2");
  await expect(tasks.nth(2).getByTestId("task-points")).toHaveText("2 / 2");
  await expect(tasks.nth(2).getByTestId("task-ok")).toBeVisible();
  await expect(tasks.nth(3).getByTestId("open-feedback")).toContainText("3 of 4 points");
  await expect(tasks.nth(3).getByTestId("open-feedback")).toContainText("ATP is missing");
  await expect(result.getByTestId("result-points")).toContainText("8");
  await expect(app.locator("[data-testid=worksheet-screen] [aria-live], [role=status]").first()).toBeAttached();

  await expect.poll(() => app.evaluate(() => Object.values((window as any).__mock.db().worksheets)[0] && (Object.values((window as any).__mock.db().worksheets)[0] as any).attempt?.checkedAt != null)).toBe(true);
  await expect.poll(() => app.evaluate(() => Object.values((window as any).__mock.db().cards ?? {}).length)).toBeGreaterThan(0);

  await screen.getByTestId("worksheet-export").click();
  await app.getByRole("menuitem", { name: "Markdown with answer key (.md)" }).click();
  await expect(app.getByText("Saved to /Users/me/Downloads/Photosynthesis worksheet.md")).toBeVisible();
  expect(await exportsOf(app)).toEqual([{ name: "Photosynthesis worksheet", extension: "md", size: expect.any(Number) }]);

  await screen.getByTestId("worksheet-export").click();
  await app.getByRole("menuitem", { name: "Print or save as PDF" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__mock.db().prints)).toBe(1);

  await screen.getByTestId("worksheet-retry").click();
  await expect(screen.getByTestId("worksheet-result")).toHaveCount(0);

  await screen.getByRole("button", { name: "Back to Biology" }).click();
  await expect(app.getByTestId("worksheets-list")).toContainText("Photosynthesis worksheet");
});

test("worksheet: German Klassenarbeit with Notenschlüssel, edit and regenerate a task, variant B", async ({ app }) => {
  await spaceWithSource(app);
  await openBuilder(app);
  await app.getByTestId("ws-preset").selectOption("klassenarbeit");
  await expect(app.getByTestId("ws-language")).toHaveValue("de");
  await expect(app.getByTestId("ws-thresholds")).toBeVisible();
  await app.getByTestId("ws-generate").click();

  const screen = app.getByTestId("worksheet-screen");
  await expect(screen.getByTestId("worksheet-title")).toHaveText("Fotosynthese Arbeitsblatt");
  const tasks = screen.getByTestId("worksheet-task");
  await expect(tasks.nth(0)).toContainText("Aufgabe 1: Ankreuzen");
  await expect(tasks.nth(1)).toContainText("Richtig oder Falsch");
  await expect(tasks.nth(2)).toContainText("Lückentext");
  await expect(tasks.nth(2).getByTestId("word-bank")).toContainText("Wörter im Kasten");
  await expect(tasks.nth(3)).toContainText("Offene Fragen");
  await expect(screen).toContainText("Klasse:");
  await expect(screen).toContainText("Datum:");
  await expect(screen.getByTestId("sheet-print")).toContainText("Mindestpunkte");

  await tasks.nth(0).getByRole("button", { name: "Edit task" }).click();
  await tasks.nth(0).getByLabel("Question").fill("Wo läuft die Fotosynthese ab?");
  await tasks.nth(0).getByRole("button", { name: "Edit task" }).click();
  await expect(tasks.nth(0)).toContainText("Wo läuft die Fotosynthese ab?");

  await tasks.nth(0).getByTestId("regenerate-task").click();
  await expect(tasks.nth(0)).toContainText("Which pigment absorbs light?");

  await tasks.nth(0).getByRole("radio", { name: /Chlorophyll/ }).click();
  await screen.getByTestId("worksheet-check").click();
  await expect(screen.getByTestId("result-grade")).toContainText("Note:");
  await expect(screen.getByTestId("grade-scale")).toContainText("Notenschlüssel");

  await screen.getByTestId("worksheet-variant").click();
  await expect(screen.getByTestId("worksheet-title")).toHaveText("Fotosynthese Arbeitsblatt (B)");
  expect(await app.evaluate(() => Object.keys((window as any).__mock.db().worksheets).length)).toBe(2);
});

test("worksheet: opening the builder from a weak topic seeds the topic; palette entry exists", async ({ app }) => {
  await spaceWithSource(app);
  const spaceId = await app.evaluate(() => (window as any).__ui.getState().route.spaceId as string);
  await app.evaluate((id) => (window as any).__ui.getState().openWorksheetBuilder(id, { topic: "Light reactions" }), spaceId);
  await expect(app.getByTestId("worksheet-builder")).toBeVisible();
  await expect(app.getByTestId("ws-topic")).toHaveValue("Light reactions");
  await app.keyboard.press("Meta+k");
  await expect(app.getByRole("option", { name: "Make a worksheet" })).toBeVisible();
});
