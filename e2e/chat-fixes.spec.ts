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

const box = (app: Page) => app.getByPlaceholder("Ask about your sources…");

test("composer drafts are kept per chat and ponder://ask appends to a draft", async ({ app }) => {
  const space = await createSpace(app, "Biology");
  await box(app).fill("first question");
  await box(app).press("Enter");
  await expect(app.getByTestId("msg-assistant")).toBeVisible();
  await expect(app.getByTestId("answer-actions")).toBeVisible();

  await app.getByRole("button", { name: "New chat" }).first().click();
  await box(app).fill("half-written thought");
  await app.getByTestId("thread-row").filter({ hasText: "first question" }).click();
  await expect(box(app)).toHaveValue("");
  await app.getByTestId("thread-row").filter({ hasText: "New chat" }).click();
  await expect(box(app)).toHaveValue("half-written thought");

  await app.evaluate((u) => (window as any).__mock.deepLink(u), `ponder://ask?q=${encodeURIComponent("What is osmosis?")}&space=${space}`);
  await expect(box(app)).toHaveValue("half-written thought\nWhat is osmosis?");
});

test("the typed text comes back when the message can't be saved", async ({ app }) => {
  await createSpace(app, "Biology");
  await app.evaluate(() => {
    const t = (window as any).__TAURI_INTERNALS__;
    const orig = t.invoke;
    t.invoke = (cmd: string, ...rest: unknown[]) =>
      cmd === "add_message" ? Promise.reject({ code: "other", message: "disk full" }) : orig.call(t, cmd, ...rest);
  });
  await box(app).fill("keep me");
  await box(app).press("Enter");
  await expect(app.locator("[data-sonner-toast]").filter({ hasText: "The answer couldn't be generated" })).toBeVisible();
  await expect(box(app)).toHaveValue("keep me");
});

test("a failed clipboard copy shows an error", async ({ app }) => {
  await createSpace(app, "Biology");
  await box(app).fill("hello");
  await box(app).press("Enter");
  await expect(app.getByTestId("answer-actions")).toBeVisible();
  await app.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
  });
  await app.getByTestId("answer-actions").getByRole("button", { name: "Copy" }).click();
  await expect(app.locator("[data-sonner-toast]").filter({ hasText: "Couldn't copy the answer" })).toBeVisible();
});

test("deleting a chat mid-answer stops it without an error", async ({ app }) => {
  test.setTimeout(120_000);
  await createSpace(app, "Biology");
  await app.evaluate(() => {
    const m = (window as any).__mock;
    m.setScript(() => ({ content: "Chloroplasts make sugar from light. ".repeat(40) }));
    m.setStreamDelay(120);
  });
  await box(app).fill("tell me everything");
  await box(app).press("Enter");
  await expect(app.getByRole("button", { name: "Stop" })).toBeVisible();

  const row = app.getByTestId("thread-row").first();
  await row.hover();
  await row.getByRole("button", { name: "More" }).click();
  await app.getByRole("menuitem", { name: "Delete" }).click();
  await app.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

  await expect(app.getByTestId("thread-row")).toHaveCount(0);
  await app.waitForTimeout(800);
  await expect(app.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect(app.getByRole("button", { name: "Stop" })).toHaveCount(0);
  const live = await app.evaluate(() => Object.keys((window as any).__mock.db().messages).length);
  expect(live).toBe(0);
});
