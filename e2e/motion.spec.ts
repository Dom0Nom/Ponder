import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

type W = Window & { __mock: { advance: (ms: number) => void; setScript: (fn: (() => { content: string }) | null) => void; setStreamDelay: (ms: number) => void } };

const advance = (page: Page, ms: number) => page.evaluate((n) => (window as unknown as W).__mock.advance(n), ms);

async function newSpace(page: Page) {
  await page.getByRole("button", { name: "New space" }).first().click();
  await page.getByLabel("Name").fill("Bio");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("chat-empty")).toBeVisible();
}

async function startFocus(page: Page) {
  await page.keyboard.press("ControlOrMeta+Shift+KeyF");
  const dialog = page.getByRole("dialog", { name: "Start a focus session" });
  await dialog.getByRole("radio", { name: /^Custom/ }).click();
  await dialog.getByLabel("Focus (min)", { exact: true }).fill("1");
  await dialog.getByLabel("Break (min)", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(dialog).toBeHidden();
}

const running = (page: Page, selector: string) =>
  page.evaluate((sel) => document.querySelectorAll(sel).length && [...document.querySelectorAll(sel)].some((e) => e.getAnimations().some((a) => a.playState === "running")), selector);

test("Reduce motion setting: html flag, effects locked off, survives a reload", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const reduce = app.getByRole("switch", { name: "Reduce motion" });
  await reduce.click();
  await expect(app.locator("html")).toHaveAttribute("data-motion", "reduce");
  const effects = app.getByRole("switch", { name: "Visual effects" });
  await expect(effects).toBeDisabled();
  await expect(effects).not.toBeChecked();
  await app.reload();
  await expect(app.locator("html")).toHaveAttribute("data-motion", "reduce");
});

test("reduced motion: key elements have no animation or transition", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  const dialog = app.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const css = await dialog.evaluate((el) => {
    const c = getComputedStyle(el);
    return { name: c.animationName, dur: c.animationDuration };
  });
  expect(css.name === "none" || parseFloat(css.dur) < 0.001).toBe(true);
  const spin = await app.evaluate(() => {
    const el = document.createElement("i");
    el.className = "m-spin";
    document.body.append(el);
    const c = getComputedStyle(el);
    const out = { iter: c.animationIterationCount, dur: c.animationDuration };
    el.remove();
    return out;
  });
  expect(spin.iter).toBe("1");
  expect(parseFloat(spin.dur)).toBeLessThan(0.001);
  const pill = await app.evaluate(() => {
    const el = document.createElement("div");
    el.className = "t-panel-slide";
    document.body.append(el);
    const d = parseFloat(getComputedStyle(el).transitionDuration);
    el.remove();
    return d;
  });
  expect(pill).toBeLessThan(0.001);
});

test.describe("motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  test("dialogs open with the modal animation", async ({ app }) => {
    await app.getByRole("button", { name: "New space" }).first().click();
    const dialog = app.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const name = await dialog.evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe("t-modal-open");
  });

  test("timer digits pop on the phase change, not every second", async ({ app }) => {
    await newSpace(app);
    await startFocus(app);
    await expect(app.getByTestId("pane-studio").locator(".m-timer .t-digit").first()).toBeVisible();
    await expect.poll(() => running(app, ".m-timer .t-digit"), { timeout: 5000 }).toBe(false);
    await app.evaluate(() => {
      const w = window as unknown as { __pops: string[] };
      w.__pops = [];
      document.addEventListener("animationstart", (e) => {
        const el = e.target as Element;
        if (el.matches(".t-digit")) w.__pops.push(el.closest("[role=dialog]") ? "break" : "timer");
      });
    });
    const pops = () => app.evaluate(() => (window as unknown as { __pops: string[] }).__pops);
    await advance(app, 3_000);
    await advance(app, 3_000);
    await app.waitForTimeout(300);
    expect(await pops()).toEqual([]);
    await advance(app, 60_000);
    await expect(app.getByRole("dialog", { name: "Break time" })).toBeVisible();
    await expect.poll(async () => (await pops()).includes("break"), { timeout: 5000 }).toBe(true);
  });

  test("streamed answers fade words in and settle to plain text", async ({ app }) => {
    await newSpace(app);
    await app.evaluate(() => {
      const m = (window as unknown as W).__mock;
      m.setScript(() => ({ content: "Chloroplasts make sugar from light. ".repeat(12) }));
      m.setStreamDelay(120);
    });
    const box = app.getByLabel("Ask about your sources…");
    await box.fill("hi");
    await box.press("Enter");
    await expect(app.locator(".t-stream-w").first()).toBeVisible();
    await expect(app.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 20_000 });
    await expect(app.locator(".t-stream-w")).toHaveCount(0);
  });

  test("Studio sub-view slides between the two pages", async ({ app }) => {
    await newSpace(app);
    const studio = app.getByTestId("pane-studio");
    await expect(studio).toBeVisible();
    const slide = studio.locator(".t-page-slide");
    await expect(slide).toHaveAttribute("data-page", "1");
    await studio.getByTestId("flashcards-tile").click();
    await expect(slide).toHaveAttribute("data-page", "2");
    await expect(studio.getByTestId("flashcards-card")).toBeVisible();
    await studio.getByRole("button", { name: "Back", exact: true }).click();
    await expect(slide).toHaveAttribute("data-page", "1");
  });
});
