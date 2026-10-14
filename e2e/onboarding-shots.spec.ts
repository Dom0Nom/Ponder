import { test, type Page } from "@playwright/test";

const OUT = "design/compare/onboarding";
const IDS = ["welcome", "ai", "search", "voice", "space", "study"];

async function fresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?onboarding");
}

for (const theme of ["light", "dark"] as const) {
  test(`onboarding screenshots (${theme})`, async ({ page }) => {
    await fresh(page);
    const wiz = page.getByTestId("onboarding");
    await wiz.getByRole("radio", { name: theme === "dark" ? "Dark" : "Light" }).click();
    for (let i = 0; i < IDS.length; i++) {
      if (i === 1) {
        await page.getByTestId("ai-key").getByLabel("API key").fill("sk-or-demo");
        await page.getByTestId("ai-key").getByRole("button", { name: "Test and save" }).click();
        await page.getByTestId("ai-connected").waitFor();
      }
      if (i === 4) {
        await page.getByLabel("Name", { exact: true }).fill("GED Math");
        await page.getByLabel("What do you want to reach?").fill("Pass the math section");
        await page.getByLabel("Exam date").fill("2027-03-01");
        await page.getByRole("button", { name: "Create space" }).click();
        await page.getByRole("button", { name: "Save changes" }).waitFor();
      }
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${i + 1}-${IDS[i]}-${theme}.png` });
      if (i < IDS.length - 1) await wiz.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await wiz.getByRole("button", { name: "Start learning" }).click();
    await page.getByTestId("tour-mark").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/7-tour-${theme}.png` });
  });
}
