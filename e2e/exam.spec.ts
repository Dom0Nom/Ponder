import { test, expect, type Page } from "./fixtures";

async function gedSpace(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED prep");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
  return app.evaluate(() => {
    const db = (window as any).__mock.db();
    const spaceId = (window as any).__ui.getState().route.spaceId as string;
    db.curricula[spaceId] = {
      spaceId,
      curriculumId: "ged",
      title: "GED",
      updatedAt: Date.now(),
      topics: [
        { id: "ged.rla.reading", title: "Reading for meaning", description: "main idea", group: "Reasoning Through Language Arts" },
        { id: "ged.rla.grammar", title: "Grammar and usage", description: "agreement", group: "Reasoning Through Language Arts" },
        { id: "ged.rla.essay", title: "Extended response essay", description: "essay", group: "Reasoning Through Language Arts" },
        { id: "ged.math.numbers", title: "Number sense", description: "fractions", group: "Math" },
      ],
    };
    (window as any).__qc.invalidateQueries();
    return spaceId;
  });
}

async function script(app: Page) {
  await app.evaluate(() => {
    const text = (m: any) => (typeof m.content === "string" ? m.content : m.content.map((p: any) => p.text ?? "").join(""));
    const passage = (side: string) => `${side} `.repeat(10) + "Evidence and claims about the issue. ".repeat(30);
    (window as any).__mock.setScript(({ messages }: any) => {
      const p = text(messages[messages.length - 1]);
      if (p.startsWith("Write multiple-choice questions for a timed")) {
        const ids = [...p.matchAll(/id "([^"]+)": [^\n]*: (\d+)/g)];
        const qs = ids.flatMap(([, id, n]) =>
          Array.from({ length: Number(n) }, (_, i) => ({ topicId: id, question: `${id} question ${i + 1}?`, options: ["Right", "Wrong A", "Wrong B", "Wrong C"], answer: 0, explanation: "Because." })),
        );
        return { content: JSON.stringify(qs) };
      }
      if (p.startsWith("Write the reading material for a GED-style"))
        return {
          content: JSON.stringify({
            issue: "Daylight saving time",
            prompt: "Analyze both positions to determine which one is best supported.",
            passages: [
              { title: "Keep the clock change", text: passage("For") },
              { title: "End the clock change", text: passage("Against") },
            ],
          }),
        };
      if (p.startsWith("You score a GED-style extended response"))
        return {
          content: JSON.stringify({
            traits: [
              { trait: 1, score: 2, reason: "You cite the sleep study." },
              { trait: 2, score: 1, reason: "Paragraph two repeats paragraph one." },
              { trait: 3, score: 2, reason: "Clean sentences." },
            ],
            summary: "Add a transition between your two reasons.",
          }),
        };
      return { content: "ok" };
    });
  });
}

test("exam: timed RLA section with flags, essay, scoring and review", async ({ app }) => {
  const spaceId = await gedSpace(app);
  await script(app);
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Practice exam" }).click();
  const page = app.getByTestId("exam");
  await expect(page.getByTestId("exam-space")).toHaveText(/GED prep/);
  await expect(page.getByTestId("exam-history")).toContainText("Your finished exams show up here.");

  await page.getByRole("radio", { name: /Reasoning Through Language Arts/ }).click();
  await expect(page.getByRole("radio", { name: /Reasoning Through Language Arts/ })).toContainText("50 min · 10 questions + essay");
  await page.getByTestId("exam-begin").click();

  const runner = app.getByTestId("exam-runner");
  await expect(runner.getByTestId("exam-question")).toContainText("Question 1 of 10");
  await expect(runner.getByTestId("exam-timer")).toHaveText(/^(50:00|49:5\d)$/);
  await expect(runner.getByRole("button", { name: "Calculator" })).toHaveCount(0);

  // answer 1–7 right, 8 wrong, leave 9–10 open; flag question 2
  for (let i = 0; i < 8; i++) {
    await runner.getByRole("radio", { name: i === 7 ? "Wrong A" : "Right", exact: true }).click();
    if (i === 1) await runner.getByRole("button", { name: "Flag for review" }).click();
    await app.keyboard.press("ArrowRight");
  }
  const nav = runner.getByTestId("exam-navigator");
  await expect(nav).toContainText("8 of 10 answered");
  await expect(nav.getByRole("button", { name: "Question 2 of 10" })).toHaveAttribute("data-flagged", "true");

  await nav.getByTestId("exam-essay-tab").click();
  const essay = runner.getByTestId("exam-essay");
  await expect(essay).toContainText("End the clock change");
  await essay.getByRole("textbox").fill("Ending the clock change is better supported. ".repeat(12));
  await expect(nav.getByTestId("exam-essay-tab")).toContainText("84 words");

  // progress survives leaving and resuming
  await app.evaluate((id) => (window as any).__ui.getState().navigate({ name: "exam", spaceId: id }), spaceId);
  await expect(page.getByTestId("exam-history")).toContainText("In progress");
  await page.getByTestId("exam-history").getByText("Reasoning Through Language Arts").click();
  await expect(runner.getByTestId("exam-navigator")).toContainText("8 of 10 answered");

  await runner.getByTestId("exam-finish").click();
  await expect(app.getByRole("dialog")).toContainText("2 questions are unanswered");
  await app.getByRole("dialog").getByRole("button", { name: "Finish" }).click();

  const result = page.getByTestId("exam-result");
  await expect(result).toContainText("7 of 10 correct");
  await expect(page.getByTestId("exam-essay-result")).toContainText("Paragraph two repeats paragraph one.");
  await expect(result).toContainText("Essay: 10 of 12 points");
  // (7 + 10) / 22 = 77% → above the 62% pass mark
  await expect(result).toContainText("Pass");
  await expect(page.getByTestId("exam-topics").locator('[data-topic="ged.rla.grammar"]')).toBeVisible();
  await expect(page.getByTestId("exam-topics").locator('[data-topic="ged.rla.essay"]')).toHaveCount(0);

  await page.getByTestId("exam-review-toggle").click();
  await expect(page.getByTestId("exam-review")).toContainText("No answer");

  await page.getByRole("button", { name: "All exams" }).click();
  await expect(page.getByTestId("exam-history")).toContainText("Pass");
});

test("exam: spaces without an exam plan get an explanation", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Cooking");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Practice exam" }).click();
  await expect(app.getByTestId("exam")).toContainText("No practice exam for this space");
});
