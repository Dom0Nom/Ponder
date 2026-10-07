import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function answerQuiz(app: Page, rightCount: number) {
  const dialog = app.getByRole("dialog");
  await expect(dialog.getByTestId("quiz-question")).toBeVisible({ timeout: 10_000 });
  let i = 0;
  while (await dialog.getByTestId("quiz-question").isVisible()) {
    const option = i < rightCount ? "Correct answer" : "Wrong A";
    await dialog.getByRole("radio", { name: option }).click();
    await dialog.getByRole("button", { name: "Check" }).click();
    await dialog.getByRole("button", { name: /Next question|See result/ }).click();
    i++;
  }
  await expect(dialog.getByTestId("quiz-result")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  return i;
}

test("placement check on a new GED space sets topic levels and the prerequisite check starts a lesson", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED prep");
  await app.getByLabel("Exam or course (optional)").selectOption("ged");
  await app.getByRole("button", { name: "Create" }).click();

  await app.getByRole("button", { name: /^Learning plan/ }).click();
  const plan = app.getByTestId("plan-card");
  await expect(plan).toContainText("GED (all four subjects)");
  await expect(plan.getByTestId("coverage-summary")).toContainText("0 covered");

  await app.getByRole("button", { name: "Take the placement check" }).first().click();
  const total = await answerQuiz(app, 10);
  expect(total).toBe(16);
  await expect(plan.getByText("Strong").first()).toBeVisible();
  await expect(plan.getByText("Needs work").first()).toBeVisible();
  await app.getByRole("button", { name: "Back to Studio" }).click();
  await expect(app.getByRole("region", { name: "Studio" })).toContainText("Placement check · GED");
  await app.getByRole("button", { name: /^Learning plan/ }).click();

  // start a topic that has prerequisites; get them all right → the chat starts the topic itself
  await plan.getByTestId("topic-row").filter({ hasText: "Percents" }).click();
  await app.getByRole("menuitem", { name: "Start this topic" }).click();
  await answerQuiz(app, 3);
  await expect(app.getByTestId("msg-user").last()).toContainText('I\'m ready to start "Percents"');
});

test("a book becomes a course with chapters", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Reading");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Tiny Book");
  const body = "Cells are the basic unit of life and every organism is made of them. ".repeat(8);
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(`# Chapter 1 Cells\n\n${body}\n\n# Chapter 2 Energy\n\n${body}\n\n# Chapter 3 Genetics\n\n${body}`);
  await app.getByRole("button", { name: "Import" }).click();
  await app.locator('[data-testid="source-row"][data-status="ready"]').click();
  await app.getByRole("button", { name: "Make a course" }).click();
  await app.getByRole("button", { name: /^Course/ }).click();
  const course = app.getByTestId("course-card");
  await expect(course).toContainText("0 of 3 chapters done");
  await expect(course.getByTestId("lesson-row")).toHaveCount(3);

  const first = course.getByTestId("lesson-row").first();
  await first.hover();
  await first.getByRole("button", { name: "Check" }).click();
  await answerQuiz(app, 3);
  await expect(course).toContainText("1 of 3 chapters done");
});
