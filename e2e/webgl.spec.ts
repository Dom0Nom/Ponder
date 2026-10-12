import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

type W = Window & {
  __gl: number;
  __ui: { getState: () => { setVisualEffects: (v: boolean) => void; setReduceMotion: (v: boolean) => void } };
  __mock: { setScript: (fn: (() => { content: string }) | null) => void; setStreamDelay: (ms: number) => void };
};

const contexts = (p: Page) => p.evaluate(() => (window as unknown as W).__gl);

const COUNT_SCRIPT = `
window.__gl = 0;
const orig = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") window.__gl++;
  return orig.call(this, type, ...rest);
};
`;

const countWebGL = (page: Page) => page.addInitScript(COUNT_SCRIPT);

async function newSpace(page: Page) {
  await page.getByRole("button", { name: "New space" }).first().click();
  await page.getByLabel("Name").fill("Bio");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("chat-empty")).toBeVisible();
}

async function walk(page: Page) {
  await newSpace(page);
  await page.waitForTimeout(1200);
  expect(await contexts(page)).toBe(0);
  await expect(page.getByTestId("chat-empty").locator("img")).toBeVisible();

  await page.evaluate(() => {
    const m = (window as unknown as W).__mock;
    m.setScript(() => ({ content: "Chloroplasts. ".repeat(20) }));
    m.setStreamDelay(60);
  });
  const box = page.getByLabel("Ask about your sources…");
  await box.fill("hi");
  await box.press("Enter");
  await expect(page.getByTestId("msg-assistant")).toBeVisible();
  await page.waitForTimeout(600);
  expect(await contexts(page)).toBe(0);
  await expect(page.getByTestId("msg-assistant")).toContainText("Chloroplasts");
  await page.evaluate(() => (window as unknown as W).__mock.setStreamDelay(15));

  await page.keyboard.press("ControlOrMeta+Shift+KeyF");
  const dialog = page.getByRole("dialog", { name: "Start a focus session" });
  await expect(dialog.getByRole("button", { name: "Start session" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await contexts(page)).toBe(0);
  await expect(dialog.locator(".metal-fx-root")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.evaluate(() => {
    const m = (window as unknown as W).__mock;
    m.setScript(null);
    m.setStreamDelay(15);
  });
  await page.evaluate(() => (window as unknown as W).__ui.getState().setImportDialog({ open: true }));
  const add = page.getByRole("dialog", { name: "Add a source" });
  await add.getByRole("tab", { name: "Deep research" }).click();
  await add.getByLabel("What do you want to learn about?").fill("photosynthesis");
  await add.getByRole("button", { name: "Research", exact: true }).click();
  await expect(add.getByText("Found sources")).toBeVisible();
  await page.waitForTimeout(600);
  expect(await contexts(page)).toBe(0);
}

test("Reduce motion: no WebGL context anywhere", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  await countWebGL(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?seed");
  await walk(page);
  await ctx.close();
});

test("Reduce motion setting: no WebGL context anywhere", async ({ app }) => {
  await countWebGL(app);
  await app.reload();
  await app.waitForFunction(() => !!(window as unknown as W).__ui);
  await app.evaluate(() => (window as unknown as W).__ui.getState().setReduceMotion(true));
  await walk(app);
});

test("Visual effects off: no WebGL context anywhere", async ({ app }) => {
  await countWebGL(app);
  await app.reload();
  await app.waitForFunction(() => !!(window as unknown as W).__ui);
  await app.evaluate(() => (window as unknown as W).__ui.getState().setVisualEffects(false));
  await walk(app);
});

test.describe("motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

test("effects on: the new-chat mark creates exactly one context", async ({ app }) => {
  await countWebGL(app);
  await app.reload();
  await app.waitForFunction(() => !!(window as unknown as W).__ui);
  await newSpace(app);
  await expect(app.getByTestId("chat-empty").locator("[data-shader='on']")).toHaveCount(1);
  await expect.poll(() => contexts(app)).toBe(1);
  await app.waitForTimeout(800);
  expect(await contexts(app)).toBe(1);
});
});
