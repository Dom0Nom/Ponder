import { test, expect } from "./fixtures";

test("empty space -> goal wizard -> skill graph -> dateless schedule", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Robotics");
  await app.getByRole("button", { name: "Create" }).click();

  await app.getByTestId("goal-start").click();
  const wizard = app.getByTestId("goal-wizard");
  await expect(wizard).toHaveAttribute("data-step", "0");
  await app.getByLabel("In one sentence").fill("Build a robot arm that picks up a cup");
  await app.getByTestId("goal-build").click();

  await expect(wizard).toHaveAttribute("data-step", "1");
  const topics = app.getByTestId("goal-topics").getByTestId("goal-topic");
  await expect(topics).toHaveCount(4);
  await expect(topics.first()).toContainText("Starting point");
  await expect(app.getByTestId("goal-count")).toContainText("4 topics");

  await app.getByLabel("Rename Control loops").fill("Feedback control");
  await app.getByLabel("Rename Control loops").blur();
  await expect(app.getByLabel("Rename Feedback control")).toBeVisible();

  await app.getByRole("button", { name: "Remove Kinematics" }).click();
  await expect(topics).toHaveCount(3);
  await expect(topics.nth(2)).toContainText("After: Motors and servos");

  await app.getByRole("checkbox", { name: "I know Electronics basics" }).check();

  await app.getByRole("button", { name: "Find sources for Motors and servos" }).click();
  await expect(app.getByRole("button", { name: "Find sources for Motors and servos" })).toBeEnabled({ timeout: 30_000 });

  await app.getByTestId("goal-next").click();
  await expect(wizard).toHaveAttribute("data-step", "2");
  await app.getByLabel("Hours per week").fill("4");
  await app.getByTestId("goal-make").click();
  await expect(wizard).toHaveCount(0);

  const db = await app.evaluate(() => (window as any).__mock.db());
  const goal = Object.values(db.goals)[0] as any;
  expect(goal.kind).toBe("skill");
  expect(goal.graph.nodes.map((n: any) => n.title)).toEqual(["Electronics basics", "Motors and servos", "Feedback control"]);
  expect(goal.graph.nodes[0].known).toBe(true);
  const plan = Object.values(db.plans)[0] as any;
  expect(plan.examDate).toBe("");
  expect(plan.weeklyMinutes).toBe(240);
  const tasks = Object.values(db.planTasks) as any[];
  expect(tasks.some((t) => t.kind === "milestone")).toBe(true);
  expect(tasks.every((t) => t.topicId !== goal.graph.nodes[0].id)).toBe(true);

  await app.getByRole("button", { name: /^Learning plan/ }).click();
  const section = app.getByTestId("schedule-section");
  await expect(section.getByTestId("plan-week")).toContainText(/Week 1 · 4 h a week/);
  await expect(section.getByTestId("plan-week")).not.toContainText("exam in");
});

test("goal wizard from the New space dialog seeds the graph from an exam outline", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED");
  await app.getByRole("button", { name: "Start from a goal" }).click();

  await app.getByRole("radio", { name: "Exam outline" }).click();
  await app.getByLabel("Exam or course").selectOption("ged");
  const d = new Date(Date.now() + 120 * 86_400_000);
  const exam = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await app.getByLabel("Date (optional)").fill(exam);
  await app.getByTestId("goal-build").click();
  await expect(app.getByTestId("goal-wizard")).toHaveAttribute("data-step", "1");
  expect(await app.getByTestId("goal-topic").count()).toBeGreaterThan(10);
  await app.getByTestId("goal-next").click();
  await app.getByTestId("goal-make").click();
  await expect(app.getByTestId("goal-wizard")).toHaveCount(0);

  const db = await app.evaluate(() => (window as any).__mock.db());
  expect((Object.values(db.goals)[0] as any).kind).toBe("exam");
  expect((Object.values(db.plans)[0] as any).examDate).toBe(exam);
});
