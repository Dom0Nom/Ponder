import { test, expect } from "./fixtures";

test("switching to German changes visible text without a reload", async ({ app }) => {
  await app.evaluate(() => {
    (window as unknown as { __marker: string }).__marker = "same page";
  });
  await app.getByRole("button", { name: "Settings" }).first().click();
  await expect(app.getByRole("heading", { name: "Settings" })).toBeVisible();
  await app.getByLabel("Language").selectOption("de");
  await expect(app.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expect(app.getByText("Darstellung")).toBeVisible();
  await expect(app.locator("html")).toHaveAttribute("lang", "de");
  await expect(app.locator("html")).toHaveAttribute("dir", "ltr");
  expect(await app.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe("same page");

  await app.getByLabel("Sprache").selectOption("en");
  await expect(app.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("the language survives a reload", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).first().click();
  await app.getByLabel("Language").selectOption("de");
  await expect(app.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await app.reload();
  await expect(app.locator("html")).toHaveAttribute("lang", "de");
  await expect(app.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
});

test("Arabic is right-to-left with the sidebar on the right and the calculator left-to-right", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).first().click();
  await app.getByLabel("Language").selectOption("ar");
  await expect(app.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(app.locator("html")).toHaveAttribute("lang", "ar");

  const side = await app.getByRole("complementary").first().boundingBox();
  const viewport = app.viewportSize()!;
  expect(side!.x).toBeGreaterThan(viewport.width / 2);
});

test("the calculator stays left-to-right in a right-to-left app", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Math");
  await app.getByRole("button", { name: "Create" }).click();
  await expect(app.getByRole("region", { name: "Chat" })).toBeVisible();
  await app.getByRole("button", { name: "Calculator" }).first().click();
  const panel = app.getByTestId("calculator-panel");
  await expect(panel).toBeVisible();
  await app.evaluate(async () => {
    const { setLocale } = await import("/src/locales/index.ts");
    await setLocale("ar");
  });
  await expect(app.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(app.getByTestId("calculator-panel")).toBeVisible();
  expect(await app.getByTestId("calculator-panel").evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
});
