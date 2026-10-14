import { test, expect } from "./fixtures";

test("worked-example ladder: up on correct, one step down on a miss, cold rung finishes", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Maths");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByTestId("practice-button").click();
  await app.getByLabel("Any topic…").fill("Percentages");
  await app.getByRole("button", { name: "Go" }).click();
  await app.getByTestId("open-ladder").click();

  const ladder = app.getByTestId("ladder-session");
  const rung = ladder.getByTestId("ladder-rung");
  await expect(rung).toHaveAttribute("data-rung", "0");
  await expect(ladder.getByTestId("ladder-question")).toContainText("What is 10% of 200?");
  await expect(ladder.getByTestId("ladder-steps")).toContainText("Write 10% as 0.1");
  await ladder.getByTestId("ladder-next").click();

  await expect(rung).toHaveAttribute("data-rung", "1");
  await expect(ladder.getByTestId("ladder-question")).toContainText("What is 10% of 300?");
  await expect(ladder.getByTestId("ladder-step-0")).toContainText("Write 10% as 0.1");
  await ladder.getByLabel("Step 3").fill("The result is 30");
  await ladder.getByTestId("ladder-check").click();
  await expect(ladder.getByTestId("ladder-result")).toContainText("Correct");
  await ladder.getByTestId("ladder-next").click();

  await expect(rung).toHaveAttribute("data-rung", "2");
  await ladder.getByLabel("Step 2").fill("something else");
  await ladder.getByLabel("Step 3").fill("The result is 40");
  await ladder.getByTestId("ladder-check").click();
  await expect(ladder.getByTestId("ladder-result")).toContainText("Not quite");
  await expect(ladder.getByTestId("ladder-blank-1")).toContainText("Multiply 0.1 by 400");
  await ladder.getByTestId("ladder-next").click();

  await expect(rung).toHaveAttribute("data-rung", "1");
  await ladder.getByLabel("Step 3").fill("The result is 30");
  await ladder.getByTestId("ladder-check").click();
  await ladder.getByTestId("ladder-next").click();

  await expect(rung).toHaveAttribute("data-rung", "2");
  await ladder.getByLabel("Step 2").fill("Multiply 0.1 by 400");
  await ladder.getByLabel("Step 3").fill("The result is 40");
  await ladder.getByTestId("ladder-check").click();
  await expect(ladder.getByTestId("ladder-result")).toContainText("Correct");
  await ladder.getByTestId("ladder-next").click();

  await expect(rung).toHaveAttribute("data-rung", "3");
  await expect(ladder.getByTestId("ladder-steps")).toHaveCount(0);
  await ladder.getByLabel("Your answer").fill("50");
  await ladder.getByTestId("ladder-check").click();
  await expect(ladder.getByTestId("ladder-result")).toContainText("You solved it on your own");
});
