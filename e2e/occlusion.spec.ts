import { test, expect, type Page } from "@playwright/test";

type MockCard = { id: string; kind: string; back: string; data: { image: string; masks: { id: string }[]; mask: string; hideAll?: boolean } };
const cards = (page: Page) =>
  page.evaluate(() => Object.values((window as unknown as { __mock: { db: () => { cards: Record<string, unknown> } } }).__mock.db().cards)) as Promise<MockCard[]>;

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId("occlusion-stage").boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2));
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1]);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: "New space" }).first().click();
  await page.getByLabel("Name").fill("Anatomy");
  await page.getByRole("button", { name: "Create" }).click();
});

test("draws two masks on an image and creates one card per mask", async ({ page }) => {
  await page.getByRole("button", { name: /^Flashcards/ }).click();
  await page.getByTestId("occlusion-editor-button").click();
  const dialog = page.getByRole("dialog", { name: "Image occlusion" });
  await dialog.getByRole("button", { name: "Choose image" }).click();
  const stage = dialog.getByTestId("occlusion-stage");
  await expect(stage.locator("img")).toBeVisible();

  await drag(page, [0.1, 0.4], [0.4, 0.6]);
  await drag(page, [0.6, 0.65], [0.9, 0.8]);
  // a click without dragging must not leave a mask behind
  await page.mouse.click((await stage.boundingBox())!.x + 5, (await stage.boundingBox())!.y + 5);
  await expect(stage.getByTestId("occlusion-mask")).toHaveCount(2);

  await dialog.getByLabel("Label for box 1").fill("Nucleus");
  await dialog.getByLabel("Label for box 2").fill("Membrane");
  await dialog.getByRole("radio", { name: "Hide all" }).click();
  await dialog.getByRole("button", { name: "Create 2 cards" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Created 2 cards")).toBeVisible();

  const saved = await cards(page);
  expect(saved).toHaveLength(2);
  expect(saved.every((c) => c.kind === "occlusion" && c.data.masks.length === 2 && c.data.hideAll)).toBe(true);
  expect(new Set(saved.map((c) => c.data.mask)).size).toBe(2);
  expect(saved.map((c) => c.back).sort()).toEqual(["Membrane", "Nucleus"]);

  // review: tested mask covered, then revealed with its label
  await page.getByTestId("flashcards-card").getByRole("button", { name: "Review" }).click();
  const view = page.getByTestId("review-session").getByTestId("occlusion-card");
  await expect(view.locator("[data-tested]")).toHaveCount(1);
  await expect(view.getByRole("img", { name: "Hidden area" })).toHaveCount(1);
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(view.locator("[data-tested]")).toHaveText(/Nucleus|Membrane/);
});

test("editing a group updates, adds and deletes cards", async ({ page }) => {
  await page.getByRole("button", { name: /^Flashcards/ }).click();
  await page.getByTestId("occlusion-editor-button").click();
  const create = page.getByRole("dialog", { name: "Image occlusion" });
  await create.getByRole("button", { name: "Choose image" }).click();
  await drag(page, [0.1, 0.1], [0.3, 0.3]);
  await drag(page, [0.5, 0.5], [0.7, 0.7]);
  await create.getByRole("button", { name: "Create 2 cards" }).click();
  await expect(create).toBeHidden();
  const before = await cards(page);

  await page.getByTestId("flashcards-card").getByRole("button", { name: "Browse cards" }).click();
  await page.getByTestId("occlusion-group").getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit image occlusion" });
  await expect(edit.getByTestId("occlusion-mask")).toHaveCount(2);
  // keyboard: select box 1, delete it from the stage
  await edit.getByRole("button", { name: "Box 1", exact: true }).click();
  await edit.getByTestId("occlusion-stage").focus();
  await page.keyboard.press("Delete");
  await expect(edit.getByTestId("occlusion-mask")).toHaveCount(1);
  await edit.getByRole("button", { name: "Add box" }).click();
  await expect(edit.getByTestId("occlusion-mask")).toHaveCount(2);
  await edit.getByLabel("Label for box 1").fill("Kept");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();

  const after = await cards(page);
  expect(after).toHaveLength(2);
  const kept = after.find((c) => c.back === "Kept")!;
  expect(before.map((c) => c.id)).toContain(kept.id);
  expect(after.every((c) => c.data.masks.length === 2)).toBe(true);
  expect(after.map((c) => c.id)).not.toContain(before.find((c) => c.id !== kept.id)!.id);
});
