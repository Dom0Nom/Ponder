import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function spaceWithSource(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByRole("textbox", { name: "Text", exact: true }).fill("Photosynthesis happens in the chloroplasts of plant cells.");
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);
}

async function ask(app: Page, q: string) {
  const box = app.getByLabel("Ask about your sources…");
  await box.fill(q);
  await box.press("Enter");
}

test("tutor saves a memory, shows it, and it can be edited in settings", async ({ app }) => {
  await spaceWithSource(app);
  await app.evaluate(() =>
    (window as any).__mock.setScript(() => ({
      content: "Got it, we'll focus on that [1].\n\n{{remember: Is preparing for the GED science test in March}}",
    })),
  );
  await ask(app, "I have my GED science test in March, where does photosynthesis happen?");
  const answer = app.getByTestId("msg-assistant");
  await expect(answer).toContainText("Remembered: Is preparing for the GED science test in March");
  await expect(answer).not.toContainText("{{remember");

  // the next prompt includes the memory
  let lastSystem = "";
  await app.exposeFunction("captureSystem", (s: string) => (lastSystem = s));
  await app.evaluate(() =>
    (window as any).__mock.setScript(({ messages }: any) => {
      (window as any).captureSystem(messages.find((m: any) => m.role === "system")?.content ?? "");
      return { content: "Sure [1]." };
    }),
  );
  await ask(app, "And what absorbs light?");
  await expect(app.getByTestId("msg-assistant")).toHaveCount(2);
  await expect.poll(() => lastSystem).toContain("- Is preparing for the GED science test in March");

  await app.getByRole("button", { name: "Edit" }).first().click();
  const section = app.getByTestId("memory-section");
  await expect(section).toContainText("Is preparing for the GED science test in March");
  await section.getByText("Is preparing for the GED science test in March").hover();
  await section.getByRole("button", { name: "Forget" }).click();
  await expect(section).toContainText("Nothing yet");
});

test("self-check and second opinion", async ({ app }) => {
  await spaceWithSource(app);
  await ask(app, "Where does photosynthesis happen?");
  const answer = app.getByTestId("msg-assistant").first();
  await expect(answer).toContainText("chloroplasts");
  await answer.hover();
  await answer.getByRole("button", { name: "Check against sources" }).click();
  const check = answer.getByTestId("self-check");
  await expect(check).toContainText("1 supported");
  await expect(check).toContainText("Not in the passages");

  await answer.hover();
  await answer.getByRole("button", { name: "Second opinion" }).click();
  await app.getByRole("button", { name: "Ask", exact: true }).click();
  const second = answer.getByTestId("second-opinion");
  await expect(second).toContainText("Second opinion");
  await expect(second).toContainText("chloroplasts");
  await second.getByRole("button", { name: "Side by side" }).click();
  await expect(app.getByRole("dialog", { name: "Compare answers" })).toBeVisible();
});
