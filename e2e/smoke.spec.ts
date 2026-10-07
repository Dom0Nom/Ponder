import { test, expect } from "./fixtures";

test("home shows empty state and creates a space", async ({ app }) => {
  await expect(app.getByText("Create your first space")).toBeVisible();
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("GED Math");
  await app.getByRole("button", { name: "Create" }).click();
  await expect(app.getByRole("region", { name: "Chat" })).toBeVisible();
  await expect(app.getByRole("banner").getByText("GED Math")).toBeVisible();
});
