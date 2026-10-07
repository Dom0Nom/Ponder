import { test as base, expect, type Page } from "@playwright/test";

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/?seed&openrouter");
    await page.getByRole("button", { name: "New space" }).first().click();
    await page.getByLabel("Name").fill("Biology");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByLabel("Ask about your sources…")).toBeVisible();
    await use(page);
  },
});

const trigger = (app: Page, name: string) => app.getByRole("button", { name }).last();
const menu = (app: Page) => app.getByTestId("model-menu");

async function usePicker(app: Page, provider: string) {
  await app.getByTestId("provider-picker").click();
  await app.getByRole("menuitemradio", { name: provider }).click();
}

test("switch provider, search and filter OpenRouter, controls follow each model", async ({ app }) => {
  await trigger(app, "mock-model").click();
  await expect(menu(app)).toBeVisible();
  await expect(menu(app).getByTestId("provider-picker")).toContainText("Mock LM Studio");
  await expect(menu(app).getByRole("menuitemradio", { name: "mock-model" })).toHaveAttribute("aria-checked", "true");
  await expect(menu(app).getByLabel("Search OpenRouter models")).toHaveCount(0);

  await usePicker(app, "OpenRouter");
  await expect(menu(app).getByTestId("provider-picker")).toContainText("OpenRouter");
  await expect(menu(app).getByRole("menuitemradio", { name: "mock-model" })).toHaveCount(0);
  await expect(menu(app).getByText("Recent", { exact: true })).toBeVisible();
  await expect(menu(app).getByText("Recommended", { exact: true })).toBeVisible();
  await expect(menu(app).getByRole("menuitemradio", { name: "claude-opus-5.5" })).toBeVisible();
  await expect(menu(app).getByRole("menuitemradio", { name: "gemma-3-27b-it" })).toHaveCount(0);

  const search = menu(app).getByLabel("Search OpenRouter models");
  await search.fill("grok");
  await expect(menu(app).getByRole("menuitemradio")).toHaveCount(1);
  await expect(menu(app).getByRole("menuitemradio", { name: "grok-4.7" })).toBeVisible();

  await search.fill("");
  await menu(app).getByRole("button", { name: "Google" }).click();
  await expect(menu(app).getByRole("menuitemradio")).toHaveText([/gemini-3.8-flash/, /gemini-3.1-pro-preview/, /gemma-3-27b-it/]);
  await menu(app).getByRole("button", { name: "DeepSeek" }).click();
  await expect(menu(app).getByRole("menuitemradio")).toHaveText([/deepseek-v4.1-flash/, /deepseek-v4-pro/]);

  await menu(app).getByRole("menuitemradio", { name: "deepseek-v4.1-flash" }).click();
  await expect(menu(app)).toHaveCount(0);
  await expect(trigger(app, "deepseek-v4.1-flash")).toBeVisible();

  // model A: reasoning effort High
  await trigger(app, "deepseek-v4.1-flash").click();
  await expect(menu(app).getByRole("menuitemradio", { name: "deepseek-v4.1-flash" })).toHaveAttribute("aria-checked", "true");
  const effort = menu(app).getByRole("radiogroup", { name: "Reasoning effort" });
  await effort.getByRole("radio", { name: "High" }).click();
  await expect(effort.getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "true");
  await menu(app).getByLabel("Search OpenRouter models").fill("mistral large");
  await menu(app).getByRole("menuitemradio", { name: "mistral-large-4-0" }).click();

  // model B has its own default
  await trigger(app, "mistral-large-4-0").click();
  const effortB = menu(app).getByRole("radiogroup", { name: "Reasoning effort" });
  await expect(effortB).toBeVisible();
  await expect(effortB.getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "false");
  await effortB.getByRole("radio", { name: "Low" }).click();
  await expect(effortB.getByRole("radio", { name: "Low" })).toHaveAttribute("aria-checked", "true");

  // back to A: its value is restored; recents list it first
  await expect(menu(app).getByRole("menuitemradio").first()).toContainText("mistral-large-4-0");
  await menu(app).getByRole("menuitemradio", { name: "deepseek-v4.1-flash" }).click();
  await trigger(app, "deepseek-v4.1-flash High").click();
  await expect(menu(app).getByRole("radiogroup", { name: "Reasoning effort" }).getByRole("radio", { name: "High" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("only supported controls are shown per model", async ({ app }) => {
  await trigger(app, "mock-model").click();
  await usePicker(app, "OpenRouter");
  await menu(app).getByLabel("Search OpenRouter models").fill("llama 4 maverick");
  await menu(app).getByRole("menuitemradio", { name: "llama-4-maverick" }).click();
  await trigger(app, "llama-4-maverick").click();
  await expect(menu(app).getByRole("radiogroup", { name: "Temperature" })).toBeVisible();
  await expect(menu(app).getByRole("radiogroup", { name: "Reasoning effort" })).toHaveCount(0);
  await expect(menu(app).getByRole("switch")).toHaveCount(0);

  await menu(app).getByLabel("Search OpenRouter models").fill("qwen3.8 flash");
  await menu(app).getByRole("menuitemradio", { name: "qwen3.8-flash" }).click();
  await trigger(app, "qwen3.8-flash").click();
  await expect(menu(app).getByRole("switch", { name: "Extended thinking" })).toBeVisible();
  await expect(menu(app).getByRole("radiogroup", { name: "Reasoning effort" })).toHaveCount(0);
});

test("keyboard: arrows move through models, typing focuses search", async ({ app }) => {
  await trigger(app, "mock-model").click();
  await usePicker(app, "OpenRouter");
  const search = menu(app).getByLabel("Search OpenRouter models");
  await search.focus();
  await app.keyboard.press("ArrowDown");
  await expect(menu(app).getByRole("menuitemradio").first()).toBeFocused();
  await app.keyboard.press("ArrowDown");
  await expect(menu(app).getByRole("menuitemradio").nth(1)).toBeFocused();
  await app.keyboard.press("ArrowUp");
  await app.keyboard.press("ArrowUp");
  await expect(search).toBeFocused();
  await app.keyboard.press("ArrowDown");
  await app.keyboard.type("grok");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("grok");
  await app.keyboard.press("ArrowDown");
  await app.keyboard.press("Enter");
  await expect(trigger(app, "grok-4.7")).toBeVisible();
});

test("Use app default and Manage models still work", async ({ app }) => {
  await trigger(app, "mock-model").click();
  await usePicker(app, "OpenRouter");
  await menu(app).getByRole("menuitemradio", { name: "claude-opus-5.5" }).click();
  await trigger(app, "claude-opus-5.5").click();
  await menu(app).getByRole("button", { name: "Use app default" }).click();
  await expect(trigger(app, "mock-model")).toBeVisible();
  await trigger(app, "mock-model").click();
  await menu(app).getByRole("button", { name: "Manage models…" }).click();
  await expect(app.getByRole("heading", { name: /AI providers/i }).first()).toBeVisible();
});

test("a provider with many models gets search", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?seed&manymodels");
  await page.getByRole("button", { name: "New space" }).first().click();
  await page.getByLabel("Name").fill("Biology");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: "mock-model" }).last().click();
  const search = page.getByTestId("model-menu").getByLabel("Search 12 models");
  await search.fill("model-7");
  await expect(page.getByTestId("model-menu").getByRole("menuitemradio")).toHaveCount(1);
  await page.getByTestId("model-menu").getByRole("menuitemradio", { name: "local-model-7" }).click();
  await expect(page.getByRole("button", { name: "local-model-7" }).last()).toBeVisible();
});
