import { test, expect } from "./fixtures";

test("adaptive practice moves the skill estimate and files typed mistakes", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Maths");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByTestId("practice-button").click();

  await app.getByLabel("Any topic…").fill("Percentages");
  await app.getByRole("button", { name: "Go" }).click();
  const session = app.getByTestId("practice-session");
  const question = session.getByTestId("practice-question");
  await expect(question).toContainText("What is 10% of");
  await expect(session.getByTestId("practice-skill")).toContainText("Skill 50/100 · 0 problems");

  const answerFor = async () => Number((await question.innerText()).match(/of (\d+)/)![1]) / 10;
  await session.getByLabel("Your answer").fill(String(await answerFor()));
  await session.getByRole("button", { name: "Check", exact: true }).click();
  await expect(session.getByTestId("practice-result")).toContainText("Correct");
  const up = await session.getByTestId("skill-change").innerText();
  const [before, after] = up.split("→").map((x) => Number(x.trim()));
  expect(after).toBeGreaterThan(before);
  await expect(app.getByTestId("practice-topics")).toContainText("Percentages");

  await session.getByRole("button", { name: "Next problem" }).click();
  await expect(question).toContainText("What is 10% of");
  await session.getByLabel("Your answer").fill(String((await answerFor()) + 3));
  await session.getByRole("button", { name: "Check", exact: true }).click();
  const result = session.getByTestId("practice-result");
  await expect(result).toContainText("Not quite");
  await expect(result).toContainText("Mistake type: Arithmetic");
  const [b2, a2] = (await session.getByTestId("skill-change").innerText()).split("→").map((x) => Number(x.trim()));
  expect(a2).toBeLessThan(b2);
  await expect(session.getByRole("button", { name: "Easier" })).toBeVisible();
  await expect(app.getByTestId("error-patterns")).toContainText("Arithmetic ×1");

  await session.getByRole("button", { name: "More like this" }).click();
  await expect(question).toContainText("What is 10% of");

  const db = await app.evaluate(() => (window as any).__mock.db());
  const mistakes = Object.values(db.mistakes) as any[];
  expect(mistakes).toHaveLength(1);
  expect(mistakes[0].errorType).toBe("arithmetic");
  expect(mistakes[0].origin).toBe("practice");

  await app.keyboard.press("Meta+k");
  await app.getByPlaceholder(/Search|Type/).fill("mistakes");
  await app.keyboard.press("Enter");
  const notebook = app.getByTestId("mistake-notebook");
  await expect(notebook.getByTestId("error-patterns")).toContainText("Arithmetic ×1");
  await expect(notebook.getByTestId("mistake")).toContainText("Arithmetic");
});
