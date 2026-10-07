import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function newSpace(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
}

async function openSteps(app: Page) {
  await app.getByRole("button", { name: "Focus details" }).click();
  await app.getByRole("button", { name: /Where do I start|Next step|All steps done/ }).click();
}

test("topic -> steps -> check one off -> progress -> survives reload", async ({ app }) => {
  await newSpace(app);
  await openSteps(app);
  const section = app.getByTestId("micro-steps");
  await section.getByLabel("What do you want to work on?").fill("Chapter 3 practice problems");
  await section.getByRole("button", { name: "Break it down" }).click();

  await expect(section.getByTestId("micro-step")).toHaveCount(3);
  await expect(section.getByTestId("micro-progress")).toHaveText("0 of 3");
  await expect(section).toContainText("For: Chapter 3 practice problems");
  await expect(section.getByTestId("micro-step").first()).toHaveAttribute("data-current", "true");
  await expect(section.getByTestId("micro-step").first()).toContainText("~2 min");

  await section.getByRole("checkbox", { name: /Open your notes/ }).click();
  await expect(section.getByTestId("micro-progress")).toHaveText("1 of 3");
  await expect(section.getByTestId("micro-step").nth(1)).toHaveAttribute("data-current", "true");

  await app.reload();
  await openSteps(app);
  const again = app.getByTestId("micro-steps");
  await expect(again.getByTestId("micro-progress")).toHaveText("1 of 3");
  await expect(again.getByRole("checkbox", { name: /Open your notes/ })).toBeChecked();

  await again.getByRole("checkbox", { name: /Read the first/ }).click();
  await again.getByRole("checkbox", { name: /Write one question/ }).click();
  await expect(again.getByTestId("micro-done")).toContainText("All steps done");

  await again.getByRole("button", { name: "Clear" }).click();
  await expect(again.getByLabel("What do you want to work on?")).toBeVisible();
});

test("a running session with a goal is used directly and shows the current step", async ({ app }) => {
  await newSpace(app);
  await app.keyboard.press("ControlOrMeta+Shift+KeyF");
  const dialog = app.getByRole("dialog", { name: "Start a focus session" });
  await dialog.getByLabel("Goal (optional)").fill("Read chapter 3");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(dialog).toBeHidden();

  await openSteps(app);
  const section = app.getByTestId("micro-steps");
  await section.getByRole("button", { name: "Where do I start?" }).click();
  await expect(section.getByTestId("micro-step")).toHaveCount(3);
  await expect(section).toContainText("For: Read chapter 3");

  await app.getByRole("button", { name: "Back to Studio" }).click();
  await expect(app.getByTestId("micro-current")).toContainText("Open your notes to the first page");
  await expect(app.getByTestId("micro-current").locator("..")).toContainText("0 of 3");

  await app.getByTestId("micro-current").click();
  await app.getByTestId("micro-steps").getByRole("checkbox", { name: /Open your notes/ }).click();
  await app.getByRole("button", { name: "Back to Studio" }).click();
  await expect(app.getByTestId("micro-current")).toContainText("Read the first paragraph");
});
