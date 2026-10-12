import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

type MockWindow = { __mock: { advance: (ms: number) => void; db: () => { clockOffset: number; planTasks: Record<string, { date: string; doneAt: number | null; kind: string }> } } };

const mockToday = (app: Page) =>
  app.evaluate(() => {
    const d = new Date(Date.now() + (window as unknown as MockWindow).__mock.db().clockOffset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

test("schedule, Today view and auto re-plan after a missed day", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED prep");
  await app.getByLabel("Exam or course (optional)").selectOption("ged");
  await app.getByRole("button", { name: "Create" }).click();

  await app.getByRole("button", { name: /^Learning plan/ }).click();
  const section = app.getByTestId("schedule-section");
  await expect(section.getByLabel("Goal")).toHaveValue("GED (all four subjects)");

  await section.getByLabel("Hours per week").fill("7");
  for (const day of ["Saturday", "Sunday"]) {
    const chip = section.getByRole("button", { name: day });
    if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
  }
  await section.getByRole("button", { name: "Make schedule" }).click();

  await expect(section.getByTestId("plan-week")).toContainText(/Week 1 of \d+ · exam in 28 days/);
  await expect(section.getByTestId("plan-task").first()).toBeVisible();
  await expect(section.getByTestId("plan-progress")).toContainText("0 of");

  await app.getByRole("button", { name: "Back to Studio" }).click();
  await expect(app.getByTestId("plan-tile")).toContainText(/Week 1 of \d+/);

  await app.getByRole("button", { name: "Home" }).click();
  const today = app.getByTestId("today-section");
  await expect(today.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(today.getByTestId("today-group").getByText("GED prep")).toBeVisible();
  const rows = today.getByTestId("plan-task");
  expect(await rows.count()).toBeGreaterThan(0);

  const first = rows.first();
  await first.getByRole("checkbox").click();
  await expect(first).toHaveAttribute("data-done", "true");

  await app.evaluate(() => (window as unknown as MockWindow).__mock.advance(2 * 86_400_000));
  await app.reload();
  await expect(app.locator("[data-sonner-toast]").filter({ hasText: /Your plan was updated: \d+ missed tasks? moved/ })).toBeVisible();

  const now = await mockToday(app);
  const stored = await app.evaluate(() => Object.values((window as unknown as MockWindow).__mock.db().planTasks));
  const open = stored.filter((t) => !t.doneAt);
  expect(open.length).toBeGreaterThan(0);
  expect(open.every((t) => t.date >= now)).toBe(true);
  expect(stored.some((t) => t.doneAt && t.date < now)).toBe(true);
});

test("Today stays hidden without a plan, and a schedule needs a curriculum or course", async ({ app }) => {
  await expect(app.getByTestId("today-section")).toHaveCount(0);
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Empty");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: /^Learning plan/ }).click();
  await expect(app.getByTestId("schedule-section")).toContainText("Pick an exam or course first");
  await expect(app.getByRole("button", { name: "Make schedule" })).toHaveCount(0);
});

test("schedule form rejects a past exam date and a plan can be deleted", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED prep");
  await app.getByLabel("Exam or course (optional)").selectOption("ged");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: /^Learning plan/ }).click();
  const section = app.getByTestId("schedule-section");

  await section.getByLabel("Exam date").fill("2020-01-01");
  await section.getByRole("button", { name: "Make schedule" }).click();
  await expect(section.getByTestId("schedule-error")).toContainText("after today");

  await section.getByLabel("Exam date").fill("2099-01-01");
  await section.getByRole("button", { name: "Make schedule" }).click();
  await expect(section.getByTestId("plan-week")).toBeVisible();

  await section.getByRole("button", { name: "Delete" }).click();
  await app.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(section.getByRole("button", { name: "Make schedule" })).toBeVisible();
});
