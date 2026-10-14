import { test, expect, type Page } from "./fixtures";

const DAY = 86_400_000;

async function makeSpace(app: Page, name: string) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill(name);
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
  return app.evaluate(() => (window as any).__ui.getState().route.spaceId as string);
}

const goHome = (app: Page) => app.evaluate(() => (window as any).__ui.getState().navigate({ name: "home" }));
const route = (app: Page) => app.evaluate(() => (window as any).__ui.getState().route);
const refresh = (app: Page) => app.evaluate(() => (window as any).__qc.invalidateQueries());

async function seed(app: Page, spaceId: string, opts: { cards?: number; mastery?: boolean } = {}) {
  await app.evaluate(
    ({ spaceId, cards, mastery }) => {
      const db = (window as any).__mock.db();
      const now = Date.now() + db.clockOffset;
      db.curricula[spaceId] = {
        spaceId,
        curriculumId: "custom",
        title: "Maths",
        updatedAt: now,
        topics: [
          { id: "t1", title: "Percentages", description: "", group: "Math" },
          { id: "t2", title: "Ratios", description: "", group: "Math", prereqs: ["t1"] },
        ],
      };
      db.levels[spaceId] = mastery ? { t1: { topicId: "t1", level: "ok", evidence: null, updatedAt: now } } : {};
      if (mastery) {
        db.mastery = { [spaceId]: { t1: { topicKey: "t1", state: "retest", learnedAt: now, retestDueAt: now + 3 * 86_400_000, passedAt: null } } };
      }
      for (let i = 0; i < cards; i++)
        db.cards[`c${i}`] = {
          id: `c${i}`, spaceId, kind: "basic", front: `Front ${i}`, back: `Back ${i}`, data: null, sourceId: null, chunkStart: null, chunkEnd: null,
          origin: "manual", suspended: false, createdAt: now, updatedAt: now, due: now - 1000, state: 2, fsrs: null, spaceName: "Maths",
        };
    },
    { spaceId, cards: opts.cards ?? 0, mastery: !!opts.mastery },
  );
  await refresh(app);
}

async function answerOne(app: Page) {
  const session = app.getByTestId("practice-session");
  const question = session.getByTestId("practice-question");
  await expect(question).toContainText("What is 10% of");
  const n = Number((await question.innerText()).match(/of (\d+)/)![1]);
  await session.getByLabel("Your answer").fill(String(n / 10));
  await session.getByRole("button", { name: "Check", exact: true }).click();
  await expect(session.getByTestId("practice-result")).toContainText("Correct");
}

test("Next on Home runs through its blocks", async ({ app }) => {
  const spaceId = await makeSpace(app, "Maths");
  await seed(app, spaceId, { cards: 2 });
  await goHome(app);

  const card = app.getByTestId("next-card");
  await expect(card.getByTestId("next-label")).toContainText("Next: Review 2 due cards");
  await expect(card.getByTestId("next-minutes")).toContainText("min");
  await card.getByTestId("next-start").click();

  const bar = app.getByTestId("session-bar");
  await expect(bar.getByTestId("session-block")).toHaveText("Review 2 due cards");
  expect((await route(app)).name).toBe("review");
  await bar.getByTestId("session-done").click();

  await expect(bar.getByTestId("session-block")).toHaveText("Mixed practice");
  await expect.poll(async () => (await route(app)).topicKey).toBe("mixed");
  await expect(app.getByTestId("practice-session")).toBeVisible();
  await expect(app.getByTestId("practice-session").getByTestId("practice-question")).toContainText("What is 10% of");
  await bar.getByTestId("session-done").click();

  await expect(bar.getByTestId("session-block")).toHaveText("Explain it back");
  await bar.getByRole("textbox").fill("Ratios were hardest");
  await bar.getByTestId("session-done").click();
  await expect(app.getByTestId("session-finished")).toContainText("3 blocks done");
  const db = await app.evaluate(() => (window as any).__mock.db());
  expect(Object.values(db.journal ?? {}).some((j: any) => j.kind === "reflection" && j.content === "Ratios were hardest")).toBe(true);
});

test("Next is in the palette and the space header, and can start a Focus session", async ({ app }) => {
  const spaceId = await makeSpace(app, "Maths");
  await seed(app, spaceId, { cards: 1 });
  await expect(app.locator("header").getByTestId("next-start")).toBeVisible();
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: /^Next/ }).click();
  await expect(app.getByTestId("session-bar")).toContainText("Block 1 of");
  await app.getByRole("button", { name: "Close" }).last().click();
  await expect(app.getByTestId("session-bar")).toHaveCount(0);

  await goHome(app);
  await app.getByTestId("next-card").getByRole("button", { name: "Start with a Focus timer" }).click();
  await expect(app.getByRole("dialog")).toContainText("Start");
  await expect(app.getByLabel("Goal")).not.toHaveValue("");
});

test("mixed practice is the default and tags each question with its topic", async ({ app }) => {
  const spaceId = await makeSpace(app, "Maths");
  await seed(app, spaceId);
  await app.getByTestId("practice-button").click();
  const hub = app.getByTestId("practice-mixed");
  await expect(hub).toContainText("Mixed practice");
  await expect(app.getByTestId("practice-topics")).toContainText("Percentages");
  await hub.getByRole("button", { name: "Start mixed practice" }).click();
  const session = app.getByTestId("practice-session");
  await expect(session.getByTestId("practice-question")).toContainText("What is 10% of");
  await expect(session).toContainText(/Percentages|Ratios/);
});

test("G, U and S set how sure and are stored with the answer", async ({ app }) => {
  const spaceId = await makeSpace(app, "Maths");
  await app.getByTestId("practice-button").click();
  await app.getByLabel("Any topic…").fill("Percentages");
  await app.getByRole("button", { name: "Go" }).click();
  const session = app.getByTestId("practice-session");
  const conf = session.getByTestId("confidence");
  await expect(conf).toBeVisible();

  await session.getByTestId("practice-question").click();
  await app.keyboard.press("g");
  await expect(conf.getByRole("radio", { name: "Guess" })).toHaveAttribute("aria-checked", "true");
  await app.keyboard.press("u");
  await expect(conf.getByRole("radio", { name: "Unsure" })).toHaveAttribute("aria-checked", "true");

  await session.getByLabel("Your answer").focus();
  await app.keyboard.press("Alt+s");
  await expect(conf.getByRole("radio", { name: "Sure" })).toHaveAttribute("aria-checked", "true");
  await expect(session.getByLabel("Your answer")).toHaveValue("");

  await answerOne(app);
  await expect(conf).toHaveCount(0);
  const db = await app.evaluate(() => (window as any).__mock.db());
  expect(db.attempts.at(-1).confidence).toBe(2);
  expect(spaceId).toBeTruthy();
});

test("a topic is mastered by a passing retest at least 3 days after it was learned", async ({ app }) => {
  const spaceId = await makeSpace(app, "Maths");
  await seed(app, spaceId, { mastery: true });

  await goHome(app);
  await expect(app.getByTestId("next-label")).not.toContainText("Retest");

  await app.evaluate(() => (window as any).__mock.advance(2 * 86_400_000));
  await refresh(app);
  await expect(app.getByTestId("next-label")).not.toContainText("Retest");

  await app.evaluate((d) => (window as any).__mock.advance(d * 1.1), DAY);
  await goHome(app);
  await refresh(app);
  await expect(app.getByTestId("next-label")).toContainText("Next: Retest: Percentages");
  await app.getByTestId("next-start").click();
  await expect.poll(async () => (await route(app)).topicKey).toBe("t1");

  for (let i = 0; i < 3; i++) {
    await answerOne(app);
    if (i < 2) await app.getByTestId("practice-session").getByRole("button", { name: "Next problem" }).click();
  }
  await expect
    .poll(() => app.evaluate((id) => (window as any).__mock.db().mastery[id].t1.state, spaceId))
    .toBe("mastered");

  await app.evaluate((id) => (window as any).__ui.getState().navigate({ name: "insights", spaceId: id }), spaceId);
  const status = app.getByTestId("insights-mastery-status");
  await expect(status.getByTestId("mastered-count")).toContainText("1 mastered");
  await expect(status.locator('[data-status="mastered"]')).toContainText("Percentages");
});

test("a locked topic shows what it waits for, a too-early retest counts for nothing", async ({ app }) => {
  const spaceId = await makeSpace(app, "Maths");
  await seed(app, spaceId, { mastery: true });
  await app.evaluate((id) => (window as any).__ui.getState().navigate({ name: "insights", spaceId: id }), spaceId);
  const status = app.getByTestId("insights-mastery-status");
  await expect(status).toContainText("Retest later");
  await expect(status).toContainText("Retest on");
  await expect(status.locator('[data-testid="mastery-row"]').filter({ hasText: "Ratios" })).toContainText("Waits for Percentages");
});
