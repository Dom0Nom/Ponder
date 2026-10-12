import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/?window=calculator");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("calculator-panel").waitFor();
}

const mode = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();
const key = (page: Page, id: string) => page.locator(`[data-key="${id}"]`).click();
const plot = (page: Page) => page.getByTestId("graph-plot");
const num = async (page: Page, attr: string) => Number(await plot(page).getAttribute(attr));

test("graphing: plots expressions, reports errors, zooms, pans and traces", async ({ page }) => {
  await open(page);
  await mode(page, "Graphing");
  await expect(page.getByTestId("graph-empty")).toBeVisible();
  await expect(plot(page)).toHaveAttribute("data-curves", "0");

  const expr = page.getByTestId("graph-expr");
  await expr.first().fill("x^2");
  await expect(plot(page)).toHaveAttribute("data-curves", "1");
  expect(await num(page, "data-samples")).toBeGreaterThan(100);
  await expect(page.getByTestId("graph-empty")).toHaveCount(0);

  await page.getByRole("button", { name: "Add expression" }).click();
  await expr.nth(1).fill("tan(x)");
  await expect(plot(page)).toHaveAttribute("data-curves", "2");
  expect(await num(page, "data-segments")).toBeGreaterThan(4);

  await expr.nth(1).fill("2+");
  await expect(page.getByTestId("graph-error")).toContainText("ends too early");
  await expect(plot(page)).toHaveAttribute("data-curves", "1");
  await expr.nth(1).fill("x = 2");
  await expect(plot(page)).toHaveAttribute("data-curves", "2");

  const width0 = (await num(page, "data-xmax")) - (await num(page, "data-xmin"));
  await page.getByRole("button", { name: "Zoom in" }).click();
  const width1 = (await num(page, "data-xmax")) - (await num(page, "data-xmin"));
  expect(width1).toBeCloseTo(width0 / 1.5, 1);
  await page.getByRole("button", { name: "Reset view" }).click();
  expect((await num(page, "data-xmax")) - (await num(page, "data-xmin"))).toBeCloseTo(width0, 1);

  const box = (await plot(page).boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy + 2);
  await expect(page.getByTestId("graph-trace")).toContainText("(0, 0)");

  const xmin0 = await num(page, "data-xmin");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 10, { steps: 4 });
  await page.mouse.up();
  expect(await num(page, "data-xmin")).toBeLessThan(xmin0);

  await page.getByRole("button", { name: "Reset view" }).click();
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await num(page, "data-xmax")) - (await num(page, "data-xmin"))).toBeLessThan(width0);
});

test("graphing: degrees change trig curves and the setup persists", async ({ page }) => {
  await open(page);
  await mode(page, "Graphing");
  await page.getByTestId("graph-expr").first().fill("sin(x)");
  await page.getByRole("radio", { name: "deg", exact: true }).click();
  await page.getByRole("button", { name: "Show roots and extrema" }).click();
  await expect(plot(page)).toHaveAttribute("data-curves", "1");
  await expect.poll(async () => num(page, "data-markers")).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByTestId("calculator-panel")).toHaveAttribute("data-mode", "graphing");
  await expect(page.getByTestId("graph-expr").first()).toHaveValue("sin(x)");
  await expect(page.getByRole("radio", { name: "deg", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("classic: Y=, graph, trace and table", async ({ page }) => {
  await open(page);
  await mode(page, "Graphing (classic)");
  await expect(page.getByTestId("classic-calc")).toHaveAttribute("data-screen", "home");

  for (const k of ["2", "add", "3", "enter"]) await key(page, k);
  expect((await page.evaluate(() => window.__classic!.state())).lines.join("\n")).toContain("5");

  for (const k of ["yeq", "x", "pow", "2", "graph"]) await key(page, k);
  await expect(page.getByTestId("classic-calc")).toHaveAttribute("data-screen", "graph");
  await expect(page.getByTestId("classic-plot")).toHaveAttribute("data-curves", "1");

  await key(page, "trace");
  for (const k of ["3", "enter"]) await key(page, k);
  await expect(page.getByTestId("classic-readout")).toContainText("X=3");
  await expect(page.getByTestId("classic-readout")).toContainText("Y=9");
  await key(page, "right");
  await expect(page.getByTestId("classic-readout")).toContainText("X=3.1666");

  await key(page, "table");
  const rows = (await page.evaluate(() => window.__classic!.state())).lines.map((l) => l.trim());
  expect(rows[0]).toMatch(/^X\s+Y1$/);
  expect(rows[1]).toMatch(/^0\s+0$/);
  expect(rows[2]).toMatch(/^1\s+1$/);
  expect(rows[3]).toMatch(/^2\s+4$/);

  for (const k of ["setup", "5", "enter", "2", "table"]) await key(page, k);
  expect((await page.evaluate(() => window.__classic!.state())).lines[1].trim()).toMatch(/^5\s+25$/);
  expect((await page.evaluate(() => window.__classic!.state())).lines[2].trim()).toMatch(/^7\s+49$/);

  await key(page, "window");
  for (const k of ["neg", "5", "enter", "5", "enter"]) await key(page, k);
  await key(page, "zoom");
  await key(page, "1");
  await expect(page.getByTestId("classic-calc")).toHaveAttribute("data-screen", "graph");
});

test("classic: physical keyboard and persistence", async ({ page }) => {
  await open(page);
  await mode(page, "Graphing (classic)");
  await page.getByTestId("classic-calc").focus();
  await page.keyboard.type("6*7");
  await page.keyboard.press("Enter");
  expect((await page.evaluate(() => window.__classic!.state())).lines.join("\n")).toContain("42");
  await page.keyboard.press("F1");
  await page.keyboard.type("x^2");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Graphing (classic)", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("classic-calc").focus();
  await page.keyboard.press("F5");
  await expect(page.getByTestId("classic-plot")).toHaveAttribute("data-curves", "1");
});

test("scientific stays the default and the switch round-trips", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("calculator-panel")).toHaveAttribute("data-mode", "scientific");
  await page.waitForFunction(() => !!window.__calc);
  await mode(page, "Graphing");
  await mode(page, "Scientific");
  await page.waitForFunction(() => !!window.__calc);
  await expect(page.getByTestId("calculator")).toBeVisible();
});

test("studio panel offers the modes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?seed");
  await page.getByRole("button", { name: "New space" }).first().click();
  await page.getByLabel("Name").fill("Algebra");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  await expect(page.getByTestId("calculator")).toBeVisible();
  await mode(page, "Graphing");
  await page.getByTestId("graph-expr").first().fill("x");
  await expect(plot(page)).toHaveAttribute("data-curves", "1");
});
