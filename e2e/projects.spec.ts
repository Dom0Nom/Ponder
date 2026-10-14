import { test, expect, type Page } from "./fixtures";

async function projectSpace(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Robotics");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
  await app.evaluate(() => {
    const db = (window as any).__mock.db();
    const spaceId = (window as any).__ui.getState().route.spaceId as string;
    db.curricula[spaceId] = {
      spaceId,
      curriculumId: "robotics",
      title: "Robotics",
      updatedAt: Date.now(),
      topics: [
        { id: "r.pwm", title: "PWM", description: "duty cycle", group: "Electronics" },
        { id: "r.ohm", title: "Ohm's law", description: "V=IR", group: "Electronics" },
      ],
    };
    db.levels[spaceId] = { "r.ohm": { topicId: "r.ohm", level: "strong", evidence: null, updatedAt: Date.now() } };
    (window as any).__qc.invalidateQueries();
  });
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Create a report, slides, mind map…" }).click();
  await app.getByTestId("create-projects").click();
}

test("projects: create, log an entry, and a blocked milestone points at the topic to study", async ({ app }) => {
  await projectSpace(app);
  await expect(app.getByTestId("projects-panel")).toContainText("No projects yet");
  await app.getByTestId("project-new").click();
  await app.getByLabel("Project", { exact: true }).fill("Line-following robot");
  await app.getByTestId("project-create").click();
  await expect(app.getByTestId("project-detail")).toBeVisible();

  await app.getByTestId("milestone-title").fill("Motors respond to PWM");
  await app.getByTestId("ms-topic-r.pwm").check();
  await app.getByTestId("ms-topic-r.ohm").check();
  await app.getByTestId("milestone-add").click();
  const row = app.getByTestId("milestone").first();
  await expect(row).toHaveAttribute("data-blocked", "true");
  await expect(row.getByTestId("milestone-blocked")).toContainText("Blocked on PWM");
  await expect(row.getByTestId("study-topic")).toHaveText(/Study PWM/);

  await app.getByTestId("log-body").fill("Wired the H-bridge, left motor spins.");
  await app.getByTestId("log-add").click();
  await expect(app.getByTestId("log-entry")).toHaveCount(1);
  await expect(app.getByTestId("log-entry").first()).toContainText("H-bridge");

  await app.evaluate(() => {
    const ui = (window as any).__ui.getState();
    const spaceId = ui.route.spaceId as string;
    (window as any).__mock.db().levels[spaceId]["r.pwm"] = { topicId: "r.pwm", level: "strong", evidence: null, updatedAt: Date.now() };
    (window as any).__qc.invalidateQueries();
  });
  await expect(row).toHaveAttribute("data-blocked", "false");
  await row.getByRole("checkbox").check({ force: true });
  await expect(app.getByTestId("project-progress")).toHaveText("1 of 1 milestones done");

  await app.getByRole("button", { name: "Back" }).click();
  await expect(app.getByTestId("project-card")).toContainText("Line-following robot");
});
