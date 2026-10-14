import { test, expect, type Page } from "./fixtures";

const GROUPS = { math: "Math", science: "Science", social: "Social Studies", rla: "Reasoning Through Language Arts" };

async function gedSpace(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED prep");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
  return app.evaluate((groups) => {
    const db = (window as any).__mock.db();
    const spaceId = (window as any).__ui.getState().route.spaceId as string;
    db.curricula[spaceId] = {
      spaceId,
      curriculumId: "ged",
      title: "GED",
      updatedAt: Date.now(),
      topics: [
        { id: "ged.math.numbers", title: "Number sense", description: "fractions", group: groups.math },
        { id: "ged.math.geometry", title: "Geometry", description: "area", group: groups.math },
        { id: "ged.sci.life", title: "Life science", description: "cells", group: groups.science },
        { id: "ged.soc.civics", title: "Civics", description: "government", group: groups.social },
        { id: "ged.rla.reading", title: "Reading for meaning", description: "main idea", group: groups.rla },
      ],
    };
    (window as any).__qc.invalidateQueries();
    return spaceId;
  }, GROUPS);
}

/** Questions are "<topic> question n?"; the first one written is given a wrong key so the answer check replaces it. */
async function script(app: Page, opts: { badKey?: boolean } = {}) {
  await app.evaluate((badKey) => {
    const text = (m: any) => (typeof m.content === "string" ? m.content : m.content.map((p: any) => p.text ?? "").join(""));
    let bad = badKey;
    (window as any).__mock.setScript(({ messages }: any) => {
      const p = text(messages[messages.length - 1]);
      if (p.startsWith("Write multiple-choice questions for a timed")) {
        const ids = [...p.matchAll(/id "([^"]+)": [^\n]*: (\d+)/g)];
        const qs = ids.flatMap(([, id, n]) =>
          Array.from({ length: Number(n) }, (_, i) => {
            const flag = bad && i === 0;
            if (flag) bad = false;
            return { topicId: id, question: `${flag ? "BADKEY " : ""}${id} question ${i + 1}?`, options: ["Right", "Wrong A", "Wrong B", "Wrong C"], answer: 0, explanation: "Because." };
          }),
        );
        return { content: JSON.stringify(qs) };
      }
      if (p.startsWith("Solve this problem carefully")) {
        const want = p.includes("BADKEY") ? "Wrong A" : "Right";
        const line = p.split("\n").find((l) => /^[A-D]: /.test(l) && l.slice(3) === want)!;
        return { content: `Working…\n{"correct": ["${line[0]}"]}` };
      }
      return { content: "ok" };
    });
  }, !!opts.badKey);
}

async function startExam(app: Page, section: RegExp) {
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Practice exam" }).click();
  const page = app.getByTestId("exam");
  await page.getByRole("radio", { name: section }).click();
  await page.getByTestId("exam-begin").click();
  const runner = app.getByTestId("exam-runner");
  await expect(runner.getByTestId("exam-question")).toBeVisible();
  return runner;
}

test("math exam: no-calculator part, then calculator; replaced questions in the header", async ({ app }) => {
  await gedSpace(app);
  await script(app, { badKey: true });
  const runner = await startExam(app, /Mathematical Reasoning/);

  const calc = runner.getByTestId("exam-calculator");
  await expect(runner.getByTestId("exam-part")).toHaveText("Part 1 of 2 · no calculator");
  await expect(calc).toBeDisabled();
  await expect(calc).toHaveText("Calculator after part 1");
  await expect(runner.getByTestId("exam-question")).toContainText("Question 1 of 12");
  await expect(runner.getByTestId("exam-replaced")).toHaveText("1 question replaced");

  const nav = runner.getByTestId("exam-navigator");
  for (let n = 1; n <= 5; n++) await expect(nav.getByRole("button", { name: `Question ${n} of 12` })).toBeEnabled();
  await expect(nav.getByRole("button", { name: "Question 6 of 12" })).toBeDisabled();

  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("ArrowRight");
  await expect(runner.getByTestId("exam-question")).toContainText("Question 5 of 12");
  await expect(runner.getByRole("button", { name: /^Next/ })).toBeDisabled();

  await runner.getByTestId("exam-next-part").click();
  await expect(app.getByRole("dialog")).toContainText("5 questions are unanswered");
  await app.getByRole("dialog").getByRole("button", { name: "Start part 2" }).click();

  await expect(runner.getByTestId("exam-question")).toContainText("Question 6 of 12");
  await expect(runner.getByTestId("exam-part")).toHaveText("Part 2 of 2 · calculator allowed");
  await expect(calc).toBeEnabled();
  await expect(calc).toHaveText("Calculator");
  await expect(nav.getByRole("button", { name: "Question 5 of 12" })).toBeDisabled();
  await expect(nav.getByRole("button", { name: "Question 12 of 12" })).toBeEnabled();
  await expect(runner.getByTestId("exam-finish")).toBeVisible();
  await expect(runner.getByTestId("exam-next-part")).toHaveCount(0);

  const saved = await app.evaluate(() => Object.values((window as any).__mock.db().exams)[0] as any);
  expect(saved.data.partStarts).toHaveLength(1);
  expect(saved.data.replaced).toBe(1);
});

test("math exam: formula sheet opens and closes", async ({ app }) => {
  await gedSpace(app);
  await script(app);
  const runner = await startExam(app, /Mathematical Reasoning/);
  await expect(runner.getByTestId("formula-sheet")).toHaveCount(0);
  await runner.getByTestId("formula-sheet-toggle").click();
  const sheet = runner.getByTestId("formula-sheet");
  await expect(sheet).toContainText("Pythagorean theorem");
  await expect(sheet).toContainText("Quadratic formula");
  await expect(sheet.locator(".katex").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Close formula sheet" }).click();
  await expect(runner.getByTestId("formula-sheet")).toHaveCount(0);
});

test("science exam: formula sheet and calculator from the start", async ({ app }) => {
  await gedSpace(app);
  await script(app);
  const runner = await startExam(app, /Science/);
  await expect(runner.getByTestId("exam-calculator")).toBeEnabled();
  await expect(runner.getByTestId("exam-part")).toHaveCount(0);
  await runner.getByTestId("formula-sheet-toggle").click();
  await expect(runner.getByTestId("formula-sheet")).toContainText("Mean");
  await expect(runner.getByTestId("formula-sheet")).toContainText("Range");
});

test("social studies has the calculator and no formula sheet", async ({ app }) => {
  await gedSpace(app);
  await script(app);
  const runner = await startExam(app, /Social Studies/);
  await expect(runner.getByTestId("exam-calculator")).toBeEnabled();
  await expect(runner.getByTestId("formula-sheet-toggle")).toHaveCount(0);
});

test("RLA has neither calculator nor formula sheet", async ({ app }) => {
  await gedSpace(app);
  await script(app);
  const runner = await startExam(app, /Reasoning Through Language Arts/);
  await expect(runner.getByTestId("exam-calculator")).toHaveCount(0);
  await expect(runner.getByTestId("formula-sheet-toggle")).toHaveCount(0);
});

test("math practice has the formula sheet, other topics don't", async ({ app }) => {
  const spaceId = await gedSpace(app);
  await app.evaluate((id) => (window as any).__ui.getState().navigate({ name: "practice", spaceId: id, topicKey: "ged.math.geometry" }), spaceId);
  const session = app.getByTestId("practice-session");
  await expect(session.getByTestId("practice-question")).toBeVisible();
  await session.getByTestId("formula-sheet-toggle").click();
  await expect(session.getByTestId("formula-sheet")).toContainText("Volume");
  await app.evaluate((id) => (window as any).__ui.getState().navigate({ name: "practice", spaceId: id, topicKey: "ged.rla.reading" }), spaceId);
  await expect(app.getByTestId("practice-session").getByTestId("practice-question")).toBeVisible();
  await expect(app.getByTestId("formula-sheet-toggle")).toHaveCount(0);
});
