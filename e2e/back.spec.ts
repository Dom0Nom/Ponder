import { test, expect } from "./fixtures";

test("practice and review have a back button to the space", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Maths");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByTestId("practice-button").click();
  await expect(app.getByRole("heading", { name: "Practice" })).toBeVisible();

  await app.getByRole("button", { name: "Back to Maths" }).click();
  await expect(app.getByTestId("practice-button")).toBeVisible();

  await app.getByTestId("practice-button").click();
  await app.keyboard.press("Meta+BracketLeft");
  await expect(app.getByTestId("practice-button")).toBeVisible();

  await app.getByRole("button", { name: "Review", exact: true }).first().click();
  await app.getByRole("button", { name: "Back to Maths" }).click();
  await expect(app.getByTestId("practice-button")).toBeVisible();
});
