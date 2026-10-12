import { test, expect } from "./fixtures";

test("insights: empty state, then charts, best time, mastery map and readiness from history", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED Math");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");

  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Insights" }).click();
  const page = app.getByTestId("insights");
  await expect(page.getByText("Nothing to show yet")).toBeVisible();
  await expect(page.getByTestId("insights-space")).toHaveText(/GED Math/);
  await expect(page.getByText("Pick a space with a learning plan")).toBeVisible();

  await app.evaluate(() => {
    const m = (window as any).__mock;
    const db = m.db();
    const ui = (window as any).__ui.getState();
    const spaceId = ui.route.spaceId as string;
    const now = Date.now() + db.clockOffset;
    const DAY = 86_400_000;
    const at = (daysAgo: number, h: number) => {
      const d = new Date(now - daysAgo * DAY);
      d.setHours(h, 0, 0, 0);
      return d.getTime();
    };
    db.curricula[spaceId] = {
      spaceId,
      curriculumId: "ged",
      title: "GED",
      updatedAt: now,
      topics: [
        { id: "n", title: "Number sense", description: "", group: "Math" },
        { id: "r", title: "Ratios", description: "", group: "Math", prereqs: ["n"] },
        { id: "e", title: "Equations", description: "", group: "Math", prereqs: ["r"] },
      ],
    };
    db.levels[spaceId] = { r: { topicId: "r", level: "weak", evidence: null, updatedAt: now } };
    db.abilities[spaceId] = { n: { topicKey: "n", topicTitle: "Number sense", theta: 2.5, n: 10, updatedAt: now } };
    db.reviews = [];
    for (let i = 0; i < 8; i++) {
      db.reviews.push({ cardId: `c${i}`, spaceId, sourceId: null, rating: 3, reviewedAt: at(10, 9) });
      db.reviews.push({ cardId: `c${i}`, spaceId, sourceId: null, rating: i < 6 ? 3 : 1, reviewedAt: at(7, 9) });
    }
    for (let i = 0; i < 20; i++) {
      db.attempts.push({ itemId: "x", topicKey: "n", topicTitle: "N", response: "1", correct: i < 19, thetaBefore: 0, thetaAfter: 0, spaceId, at: at(1 + (i % 5), 10) });
      db.attempts.push({ itemId: "x", topicKey: "n", topicTitle: "N", response: "1", correct: i < 10, thetaBefore: 0, thetaAfter: 0, spaceId, at: at(1 + (i % 5), 19) });
    }
    for (let d = 1; d <= 4; d++)
      db.sessions[`s${d}`] = { id: `s${d}`, spaceId, technique: "pomodoro", goal: null, startedAt: at(d, 21), endedAt: null, focusMs: 30 * 60_000, breakMs: 0, pauses: 0, summary: null };
  });
  await app.evaluate(() => (window as any).__qc.invalidateQueries());

  await expect(page.getByTestId("insights-focus")).toContainText("2 h 0 min in total");
  await expect(page.getByTestId("insights-retention")).toContainText("3–7 days");
  await expect(page.getByTestId("insights-retention")).toContainText("75% of 8");
  await expect(page.getByTestId("insights-time")).toContainText("You answer most accurately in the morning: 89%, against 50%");

  const map = page.getByTestId("insights-mastery");
  await expect(map.locator('[data-topic="n"]')).toHaveAttribute("data-tone", "strong");
  await expect(map.locator('[data-topic="r"]')).toHaveAttribute("data-tone", "weak");
  await expect(map.locator('[data-topic="e"]')).toHaveAttribute("data-tone", "unknown");
  await expect(map.locator("svg path")).toHaveCount(2);
  await expect(page.getByTestId("insights-readiness")).toContainText("chance to pass");
  await expect(page.getByTestId("insights-readiness")).toContainText("based on 2 of 3 topics");

  await map.locator('[data-topic="e"]').click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route)).toMatchObject({ name: "practice", topicKey: "e" });
});
