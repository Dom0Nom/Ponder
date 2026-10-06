import { test as base, expect, type Page } from "@playwright/test";

/** Fresh mock backend per test; `?seed` adds a mock LLM provider set as default. */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.goto("/?seed");
    await use(page);
  },
});

export { expect };
