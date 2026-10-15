import { test, expect, type Page } from "./fixtures";

test.setTimeout(150_000);

async function gedSpace(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED prep");
  await app.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => app.evaluate(() => (window as any).__ui.getState().route.name)).toBe("space");
  await app.evaluate(() => {
    const db = (window as any).__mock.db();
    const spaceId = (window as any).__ui.getState().route.spaceId as string;
    db.curricula[spaceId] = {
      spaceId,
      curriculumId: "ged",
      title: "GED",
      updatedAt: Date.now(),
      topics: [{ id: "ged.math.numbers", title: "Number sense", description: "fractions", group: "Math" }],
    };
    (window as any).__qc.invalidateQueries();
  });
}

const QUESTIONS = [
  { topicId: "ged.math.numbers", kind: "multi", prompt: "Which are prime?", options: ["2", "3", "4", "5"], answers: [0, 1, 3] },
  { topicId: "ged.math.numbers", kind: "fill", prompt: "What is half of 5?", accepted: ["2.5"], numeric: true },
  { topicId: "ged.math.numbers", kind: "dropdown", prompt: "Complete the sentence.", text: "A fraction has a {1} and a {2}.", blanks: [{ options: ["numerator", "radical"], answer: 0 }, { options: ["root", "denominator"], answer: 1 }] },
  { topicId: "ged.math.numbers", kind: "drag", mode: "order", prompt: "Order from smallest to largest.", items: ["1/2", "1/4", "3/4", "1"], correctOrder: [1, 0, 2, 3] },
  { topicId: "ged.math.numbers", kind: "drag", mode: "categorize", prompt: "Sort the numbers.", items: ["2", "3", "4", "9"], categories: ["Even", "Odd"], correctCategory: [0, 1, 0, 1] },
  { topicId: "ged.math.numbers", kind: "hotspot", prompt: "Click the point (2, 3).", stimulus: { type: "plane", xMin: -5, xMax: 5, yMin: -5, yMax: 5, points: [{ x: 2, y: 3, label: "A" }] }, region: { shape: "circle", x: 2, y: 3, r: 0.8 } },
  { topicId: "ged.math.numbers", kind: "hotspot", prompt: "Click the largest value.", stimulus: { type: "table", columns: ["Item", "Value"], rows: [["a", "4"], ["b", "9"]] }, region: { shape: "cell", row: 1, col: 1 } },
  {
    topicId: "ged.math.numbers",
    kind: "mc",
    prompt: "Which month had the most sales?",
    options: ["Jan", "Feb", "Mar", "Apr"],
    answer: 2,
    stimulus: { type: "chart", chart: { type: "bar", title: "Sales", categories: ["Jan", "Feb", "Mar", "Apr"], series: [{ name: "Units", values: [3, 5, 9, 4] }] } },
  },
  { topicId: "ged.math.numbers", question: "Plain question 1?", options: ["Right", "Wrong A", "Wrong B", "Wrong C"], answer: 0, explanation: "Because." },
  { topicId: "ged.math.numbers", question: "Plain question 2?", options: ["Right", "Wrong A", "Wrong B", "Wrong C"], answer: 0, explanation: "Because." },
  { topicId: "ged.math.numbers", question: "Plain question 3?", options: ["Right", "Wrong A", "Wrong B", "Wrong C"], answer: 0, explanation: "Because." },
  { topicId: "ged.math.numbers", question: "Plain question 4?", options: ["Right", "Wrong A", "Wrong B", "Wrong C"], answer: 0, explanation: "Because." },
];

test("rich questions: every kind can be answered by mouse and keyboard, partial credit and review", async ({ app }) => {
  await gedSpace(app);
  await app.evaluate((qs) => {
    const text = (m: any) => (typeof m.content === "string" ? m.content : m.content.map((p: any) => p.text ?? "").join(""));
    (window as any).__mock.setScript(({ messages }: any) => {
      const p = text(messages[messages.length - 1]);
      // Math is written in two parts: the first 5 questions without a calculator, the rest with one
      if (p.startsWith("Write questions of several kinds for a timed"))
        return { content: JSON.stringify(p.includes("No calculator is allowed") ? qs.slice(0, 5) : qs.slice(5)) };
      return { content: "ok" };
    });
  }, QUESTIONS);
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Practice exam" }).click();
  const page = app.getByTestId("exam");
  await page.getByRole("radio", { name: /Mathematical Reasoning/ }).click();
  await page.getByTestId("exam-begin").click();

  const runner = app.getByTestId("exam-runner");
  const q = runner.getByTestId("exam-question");
  await expect(q).toContainText("Question 1 of 12", { timeout: 60_000 });

  // 1 multi: two of three right picks (partial credit)
  await q.getByLabel("2", { exact: true }).check();
  await q.getByLabel("3", { exact: true }).check();
  await q.getByRole("button", { name: "Next" }).click();

  // 2 fill
  await expect(q).toContainText("What is half of 5?");
  await q.getByTestId("fill-input").fill("5/2");
  await q.getByRole("button", { name: "Next" }).click();

  // 3 dropdown
  await expect(q.getByTestId("dropdown-text")).toBeVisible();
  await q.getByLabel("Blank 1").selectOption({ label: "numerator" });
  await q.getByLabel("Blank 2").selectOption({ label: "denominator" });
  await q.getByRole("button", { name: "Next" }).click();

  // 4 order: starts scrambled, keyboard arrows move the focused item
  const order = q.getByTestId("drag-order");
  await expect(order).toBeVisible();
  const itemsNow = async () => (await order.locator("li button.cursor-grab").allTextContents()).map((x) => x.trim());
  const target = ["1/4", "1/2", "3/4", "1"];
  for (let guard = 0; guard < 12; guard++) {
    const cur = await itemsNow();
    const wrong = cur.findIndex((v, i) => v !== target[i]);
    if (wrong < 0) break;
    const from = cur.indexOf(target[wrong]);
    const btn = order.locator("li").nth(from).locator("button.cursor-grab");
    await btn.focus();
    for (let k = from; k > wrong; k--) await app.keyboard.press("ArrowUp");
  }
  expect(await itemsNow()).toEqual(target);
  await q.getByRole("button", { name: "Next" }).click();

  // 5 categorize: pick up an item, then a category
  await expect(q.getByTestId("drag-categorize")).toBeVisible();
  const place = async (item: string, cat: string) => {
    await q.locator(`[data-item]`).filter({ hasText: new RegExp(`^${item}$`) }).first().click();
    await q.getByRole("group", { name: cat }).getByRole("button").first().click();
  };
  await place("2", "Even");
  await place("3", "Odd");
  await place("4", "Even");
  await place("9", "Odd");
  await expect(q.getByTestId("drag-categorize")).toContainText("All items placed");
  // question 5 ends the no-calculator part
  await runner.getByTestId("exam-next-part").click();
  await app.getByRole("dialog").getByRole("button", { name: "Start part 2" }).click();

  // 6 hotspot on a plane: click at (2, 3)
  const plane = q.getByTestId("stimulus-plane").locator("svg");
  const box = (await plane.boundingBox())!;
  await plane.click({ position: { x: (22 + 0.7 * 216) * (box.width / 260), y: (260 - 22 - 0.8 * 216) * (box.height / 260) } });
  await expect(plane.locator(".m-hotspot-pin")).toHaveCount(1);
  await q.getByRole("button", { name: "Next" }).click();

  // 7 hotspot on a table cell
  await q.locator('[data-cell="1-1"]').click();
  await q.getByRole("button", { name: "Next" }).click();

  // 8 mc with a chart stimulus
  await expect(q.getByTestId("stimulus-chart")).toBeVisible();
  await q.getByRole("radio", { name: "Mar" }).click();

  const nav = runner.getByTestId("exam-navigator");
  await expect(nav).toContainText("8 of 12 answered");
  await runner.getByTestId("exam-finish").click();
  await app.getByRole("dialog").getByRole("button", { name: "Finish" }).click();

  // 7 full points + 2/3 for the multi question, rounded to a quarter
  const result = page.getByTestId("exam-result");
  await expect(result).toContainText(/7[.,]75/, { timeout: 30_000 });
  await page.getByTestId("exam-review-toggle").click();
  const review = page.getByTestId("exam-review");
  await expect(review.getByTestId("exam-review-rich").first()).toBeVisible();
  await expect(review.getByTestId("exam-review-rich").first().getByTestId("multi-options")).toContainText("5");
});
