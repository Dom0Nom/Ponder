import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function spaceWithSource(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill("Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light.");
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
}

test("make cards from sources, review them, and see them leave the queue", async ({ app }) => {
  await spaceWithSource(app);
  await app.getByRole("button", { name: "Flashcards", exact: true }).click();
  const card = app.getByTestId("flashcards-card");
  await card.getByRole("button", { name: "Make cards from sources" }).click();
  await app.getByRole("dialog").getByRole("button", { name: "Make flashcards" }).click();
  await expect(card.getByTestId("card-counts")).toContainText("2 new / 2 total");

  await card.getByRole("button", { name: "Review" }).click();
  const session = app.getByTestId("review-session");
  await expect(session).toContainText("2 left");
  await app.keyboard.press("Space");
  await expect(session.getByRole("button", { name: /Good/ })).toBeVisible();
  await app.keyboard.press("4");
  await expect(session).toContainText("1 reviewed");
  await app.getByRole("button", { name: "Show answer" }).click();
  await session.getByRole("button", { name: /Easy/ }).click();
  await expect(app.getByTestId("review-empty")).toContainText("2 cards reviewed");
  const states = await app.evaluate(() => Object.values((window as any).__mock.db().cards).map((c: any) => c.state));
  expect(states.every((s: number) => s === 2)).toBe(true);
});

test("quiz mistakes go to the notebook and come back as review cards", async ({ app }) => {
  await spaceWithSource(app);
  await app.getByRole("button", { name: "Flashcards", exact: true }).click();
  await app.getByTestId("flashcards-card").getByRole("button", { name: "Quiz me" }).click();
  const dialog = app.getByRole("dialog");
  for (let i = 0; i < 5; i++) {
    await dialog.getByRole("radio", { name: i < 3 ? "Correct answer" : "Wrong A" }).click();
    await dialog.getByRole("button", { name: "Check" }).click();
    await dialog.getByRole("button", { name: /Next question|See result/ }).click();
  }
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(app.getByText("2 saved to your mistake notebook")).toBeVisible();

  await app.getByTestId("flashcards-card").getByRole("button", { name: "Review" }).click();
  await app.getByRole("tab", { name: "Mistake notebook" }).click();
  await expect(app.getByTestId("mistake")).toHaveCount(2);
  await expect(app.getByTestId("mistake").first()).toContainText("Your answer: Wrong A");

  await app.getByRole("tab", { name: "Cards" }).click();
  const session = app.getByTestId("review-session");
  await expect(session).toContainText("From a mistake");
  await session.getByRole("radio", { name: "Correct answer" }).click();
  await session.getByRole("button", { name: /Good/ }).click();
  await expect(session).toContainText("1 reviewed");
});

test("select text in a source to make a cloze card", async ({ app }) => {
  await spaceWithSource(app);
  await app.locator('[data-testid="source-row"][data-status="ready"]').click();
  const textEl = app.getByTestId("source-text");
  await textEl.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent!.indexOf("chloroplasts");
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + "chloroplasts".length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        break;
      }
    }
    document.dispatchEvent(new MouseEvent("mouseup"));
  });
  await app.getByRole("button", { name: "Make card", exact: true }).click();
  await expect(app.getByLabel("Text with gaps")).toHaveValue("Photosynthesis happens in the {{c1::chloroplasts}} of plant cells.");
  await app.getByRole("dialog").getByRole("button", { name: "Add card" }).click();
  await app.getByRole("button", { name: "Flashcards", exact: true }).click();
  await expect(app.getByTestId("card-counts")).toContainText("1 total");
  const card = await app.evaluate(() => Object.values((window as any).__mock.db().cards)[0] as any);
  expect(card.kind).toBe("cloze");
  expect(card.chunkStart).toBe("Photosynthesis happens in the ".length);
});
