import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const NOTES = `Plants need light. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.`;

async function addPdf(app: Page, origin: string) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Light notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(NOTES);
  await app.getByRole("button", { name: "Import" }).click();
  const row = app.locator('[data-testid="source-row"][data-status="ready"]');
  await expect(row).toBeVisible();
  await app.evaluate(
    ([origin, second]) => {
      const db = (window as any).__mock.db();
      const src = Object.values(db.sources)[0] as any;
      src.kind = "pdf";
      src.origin = origin;
      db.texts[src.id].pages = [
        [1, 0],
        [2, second],
      ];
    },
    [origin, NOTES.indexOf("The Calvin")] as const,
  );
  await row.click();
}

test("PDF pages: highlight on the page, see it in the text view", async ({ app }) => {
  await addPdf(app, "/Users/me/light.pdf");
  await app.getByRole("button", { name: "Pages" }).click();
  const pages = app.getByTestId("pdf-page");
  await expect(pages).toHaveCount(2);
  const layer = pages.nth(1).locator(".textLayer");
  await expect(layer).toContainText("ATP and NADPH");

  await layer.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      const i = n.data.indexOf("ATP and NADPH");
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + "ATP and NADPH".length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      document.dispatchEvent(new MouseEvent("mouseup"));
      return;
    }
  });
  await expect(app.getByRole("button", { name: "Make card", exact: true })).toBeVisible();
  await app.keyboard.press("h");
  await expect(app.getByTestId("pdf-highlight")).toHaveCount(1);
  const saved = await app.evaluate(() => (window as any).__mock.db().annotations as any[]);
  expect(saved).toMatchObject([{ quote: "ATP and NADPH", start: NOTES.indexOf("ATP") }]);

  const box = await pages.nth(1).locator(".pdf-highlight").first().boundingBox();
  await app.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await app.getByRole("textbox", { name: "Note" }).fill("energy carriers");
  await app.getByRole("button", { name: "Save note" }).click();
  await expect(pages.nth(1).locator(".pdf-highlight[data-note]")).toHaveCount(1);

  await app.getByRole("button", { name: "Pages" }).click();
  await expect(app.locator("mark.user-highlight")).toHaveText("ATP and NADPH");
});

test("PDF pages: a moved original offers the text instead", async ({ app }) => {
  await addPdf(app, "/Users/me/missing.pdf");
  await app.getByRole("button", { name: "Pages" }).click();
  await expect(app.getByText("The original PDF isn't on this computer anymore")).toBeVisible();
  await app.getByRole("button", { name: "Show text" }).click();
  await expect(app.getByTestId("source-text")).toContainText("Calvin cycle");
});
