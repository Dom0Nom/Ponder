import { test, expect, type Page } from "@playwright/test";

const text = (page: Page) => page.evaluate(() => window.__calc!.text());

async function open(page: Page) {
  await page.goto("/?window=calculator");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__calc);
}

test("keys on the keypad evaluate and show history", async ({ page }) => {
  await open(page);
  for (const k of ["1", "add", "1", "enter"]) await page.locator(`[data-key="${k}"]`).click();
  expect(await text(page)).toEqual({ lines: ["1+1\t2"], indicators: ["DEG", "↑", "↓"] });
  for (const k of ["3", "frac", "4", "enter", "toggle"]) await page.locator(`[data-key="${k}"]`).click();
  expect((await text(page)).lines).toEqual(["\\f{3}{4}\t\\f{3}{4}", "\\f{3}{4}◂▸\t0.75"]);
});

test("physical keyboard drives the calculator", async ({ page }) => {
  await open(page);
  await page.keyboard.type("6*7");
  await page.keyboard.press("Enter");
  await page.keyboard.type("12");
  await page.keyboard.press("Backspace");
  expect((await text(page)).lines).toEqual(["6*7\t42", "1"]);
  await page.keyboard.press("Escape");
  expect((await text(page)).lines).toEqual(["6*7\t42"]);
});

test("2nd functions, menus and the test hook", async ({ page }) => {
  await open(page);
  await page.locator('[data-key="2nd"]').click();
  expect((await text(page)).indicators).toEqual(["2ND", "DEG"]);
  await page.locator('[data-key="square"]').click();
  await page.locator('[data-key="8"]').click();
  await page.locator('[data-key="enter"]').click();
  expect((await text(page)).lines).toEqual(["√{8}\t2√{2}"]);
  await page.evaluate(() => {
    for (const k of ["8", "prb", "1", "3", "enter"]) window.__calc!.press(k);
  });
  expect((await text(page)).lines.at(-1)).toBe("8 nPr 3\t336");
  await page.locator('[data-key="up"]').click();
  await page.locator('[data-key="up"]').click();
  await page.locator('[data-key="enter"]').click();
  expect((await text(page)).lines.at(-1)).toBe("8 nPr 3");
});

test("state carries over to a new window", async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => {
    for (const k of ["5", "sto", "var", "enter"]) window.__calc!.press(k);
  });
  const other = await context.newPage();
  await other.goto("/?window=calculator");
  await other.waitForFunction(() => !!window.__calc);
  expect((await other.evaluate(() => window.__calc!.text())).lines).toEqual(["5→x\t5"]);
  await other.evaluate(() => {
    for (const k of ["var", "mul", "2", "enter"]) window.__calc!.press(k);
  });
  expect((await other.evaluate(() => window.__calc!.text())).lines.at(-1)).toBe("x*2\t10");
});

test("display canvas keeps the device proportions at any scale", async ({ page }) => {
  await open(page);
  const lcd = await page.getByTestId("calc-lcd").boundingBox();
  const device = await page.getByTestId("calculator").boundingBox();
  expect(lcd && device).toBeTruthy();
  expect(lcd!.width / lcd!.height).toBeCloseTo(245 / 105, 1);
  expect(lcd!.width / device!.width).toBeCloseTo(245 / 267.9, 2);
});
