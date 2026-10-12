import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const NOTES = `Plants need light. Chlorophyll absorbs light energy.

The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.`;

async function openSource(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Light notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(NOTES);
  await app.getByRole("button", { name: "Import" }).click();
  await app.locator('[data-testid="source-row"][data-status="ready"]').click();
  await expect(app.getByTestId("source-text")).toContainText("Calvin cycle");
}

/** Selects from the nth occurrence of `from` to the end of `to` inside the source text. */
async function select(app: Page, from: string, nth: number, to: string) {
  await app.getByTestId("source-text").evaluate(
    (el, [from, nth, to]) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      let seen = 0;
      const r = document.createRange();
      let started = false;
      for (const n of nodes) {
        if (!started) {
          let i = -1;
          while ((i = n.data.indexOf(from as string, i + 1)) !== -1) {
            if (seen++ === nth) {
              r.setStart(n, i);
              started = true;
              break;
            }
          }
        }
        if (started) {
          const j = n.data.indexOf(to as string, n === r.startContainer ? r.startOffset : 0);
          if (j !== -1) {
            r.setEnd(n, j + (to as string).length);
            break;
          }
        }
      }
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      document.dispatchEvent(new MouseEvent("mouseup"));
    },
    [from, nth, to] as const,
  );
}

test("highlight a passage, add a note, and remove it", async ({ app }) => {
  await openSource(app);
  await select(app, "light", 1, "energy");
  await expect(app.getByRole("button", { name: "Make card", exact: true })).toBeVisible();
  await app.keyboard.press("h");
  const mark = app.locator("mark.user-highlight");
  await expect(mark).toHaveText("light energy");
  const saved = await app.evaluate(() => (window as any).__mock.db().annotations as any[]);
  expect(saved).toHaveLength(1);
  expect(saved[0].start).toBe(NOTES.indexOf("light energy"));
  expect(saved[0].quote).toBe("light energy");

  await mark.click();
  await app.getByLabel("Note", { exact: true }).fill("Mostly red and blue light");
  await app.getByRole("button", { name: "Save note" }).click();
  await expect(app.getByTestId("highlight-editor")).toBeHidden();
  await expect(mark).toHaveAttribute("data-note", "");

  await app.getByTestId("reading-tools-toggle").click();
  const list = app.getByTestId("highlight-list");
  await expect(list.getByTestId("highlight-item")).toHaveCount(1);
  await expect(list).toContainText("Mostly red and blue light");

  await mark.click();
  await app.getByRole("button", { name: "Remove highlight" }).click();
  await expect(mark).toHaveCount(0);
  await expect(list).toBeHidden();
});

test("a highlight across paragraphs keeps exact offsets and survives reopening", async ({ app }) => {
  await openSource(app);
  await select(app, "energy", 0, "Calvin");
  await app.getByRole("button", { name: "Make card", exact: true }).hover();
  await app.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(app.locator("mark.user-highlight")).toHaveCount(1);
  const saved = await app.evaluate(() => (window as any).__mock.db().annotations as any[]);
  expect(saved[0].quote).toBe("energy.\n\nThe Calvin");
  await app.getByRole("button", { name: "Back", exact: true }).click();
  await app.locator('[data-testid="source-row"][data-status="ready"]').click();
  const mark = app.locator("mark.user-highlight");
  await expect(mark).toContainText("energy.");
  await expect(mark).toContainText("The Calvin");
  await expect(mark).not.toContainText("cycle");
});
