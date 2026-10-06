import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// 2x2 white PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8//8/AxJgYkAFAD0SAwF4ZR1YAAAAAElFTkSuQmCC",
  "base64",
);

async function openChecker(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Algebra");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByTestId("step-checker-button").click();
  return app.getByTestId("step-checker");
}

async function expectSignErrorAtStep1(app: Page) {
  const checker = app.getByTestId("step-checker");
  const rows = checker.getByTestId("step-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveAttribute("data-status", "wrong");
  for (const i of [1, 2, 3]) await expect(rows.nth(i)).toHaveAttribute("data-status", "ok");
  const first = checker.getByTestId("first-wrong");
  await expect(first).toContainText("wasn't applied to every term");
  await expect(first).toContainText("checked by calculation");
  await expect(checker.getByTestId("step-summary")).toContainText("Step 1 is where it goes wrong");
  await expect(checker.getByTestId("step-summary")).toContainText("Final answer: wrong");
  await expect(checker.getByTestId("step-fix")).toHaveCount(0);
  await first.getByRole("button", { name: "Show the fix" }).click();
  await expect(checker.getByTestId("step-fix")).toBeVisible();
}

test("flags the exact step with a sign error and saves it as a mistake", async ({ app }) => {
  const checker = await openChecker(app);
  await expect(checker).toContainText("Nothing to check yet");
  await checker.getByLabel("Problem").fill("Solve -2(x-3)+4=10");
  await checker.getByLabel("Your steps, one per line").fill("-2x-6+4=10\n-2x-2=10\n-2x=12\nx=-6");
  await expect(checker.getByTestId("step-row").first().locator(".katex")).toBeVisible();
  await checker.getByRole("button", { name: "Check my steps" }).click();
  await expectSignErrorAtStep1(app);
  await expect(app.getByText("Saved to your mistake notebook")).toBeVisible();
  const mistakes = await app.evaluate(() => Object.values((window as any).__mock.db().mistakes) as any[]);
  expect(mistakes).toHaveLength(1);
  expect(mistakes[0]).toMatchObject({ origin: "step check", question: "Solve -2(x-3)+4=10", given: "-2x-6+4=10", correct: "-2x+6+4=10" });

  await checker.getByLabel("Your steps, one per line").fill("-2x+6+4=10\n-2x=0\nx=0");
  await checker.getByRole("button", { name: "Check my steps" }).click();
  await expect(checker.getByTestId("step-summary")).toContainText("Every step checks out");
  await expect(checker.getByTestId("step-row").and(app.locator('[data-status="ok"]'))).toHaveCount(3);
});

test("reads steps from an uploaded photo, then checks them", async ({ app }) => {
  const checker = await openChecker(app);
  await checker.getByRole("button", { name: "Use a photo" }).click();
  const photo = app.getByRole("dialog", { name: "Use a photo of your work" });
  await photo.getByTestId("step-photo-input").setInputFiles({ name: "work.png", mimeType: "image/png", buffer: PNG });
  await expect(photo.getByTestId("photo-preview")).toBeVisible();
  await photo.getByRole("button", { name: "Read my work" }).click();
  await expect(photo).toBeHidden();
  await expect(checker.getByLabel("Problem")).toHaveValue("Solve -2(x-3)+4=10");
  await expect(checker.getByLabel("Your steps, one per line")).toHaveValue("-2x-6+4=10\n-2x-2=10\n-2x=12\nx=-6");
  await expect(checker).toContainText("Read 4 steps");
  await checker.getByRole("button", { name: "Check my steps" }).click();
  await expectSignErrorAtStep1(app);
});

test("pasting an image opens the photo reader with it", async ({ app }) => {
  const checker = await openChecker(app);
  await checker.getByLabel("Your steps, one per line").focus();
  await app.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "paste.png", { type: "image/png" }));
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG.toString("base64"));
  const photo = app.getByRole("dialog", { name: "Use a photo of your work" });
  await expect(photo.getByTestId("photo-preview")).toBeVisible();
  await photo.getByRole("button", { name: "Read my work" }).click();
  await expect(checker.getByTestId("step-row")).toHaveCount(4);
});
