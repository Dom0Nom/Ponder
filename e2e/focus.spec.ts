import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

type MockWindow = Window & {
  __mock: { advance: (ms: number) => void; db: () => { focusEvents: { kind: string }[] } };
};

async function startOneMinuteSession(app: Page) {
  await expect(app.getByRole("button", { name: "Search" })).toBeVisible();
  await app.keyboard.press("ControlOrMeta+Shift+KeyF");
  const dialog = app.getByRole("dialog", { name: "Start a focus session" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: /^Custom/ }).click();
  await dialog.getByLabel("Focus (min)", { exact: true }).fill("1");
  await dialog.getByLabel("Break (min)", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(dialog).toBeHidden();
  await expect(app.getByRole("button", { name: /^Focus, .* left$/ })).toBeVisible();
}

const advance = (app: Page, ms: number) => app.evaluate((n) => (window as unknown as MockWindow).__mock.advance(n), ms);

test("break locks the app until “I need the app”, which is logged", async ({ app }) => {
  await startOneMinuteSession(app);
  await advance(app, 61_000);

  const overlay = app.getByRole("dialog", { name: "Break time" });
  await expect(overlay).toBeVisible();
  await app.keyboard.press("Escape");
  await app.keyboard.press("Meta+k");
  await expect(overlay).toBeVisible();
  await expect(app.getByPlaceholder("Type a command or search…")).toHaveCount(0);

  await overlay.getByRole("button", { name: "I need the app" }).click();
  await expect(overlay).toBeHidden();
  await expect(app.getByText("Break paused")).toBeVisible();
  const kinds = await app.evaluate(() => (window as unknown as MockWindow).__mock.db().focusEvents.map((e) => e.kind));
  expect(kinds).toContain("need_app_pause");

  await app.getByRole("button", { name: "Resume break" }).click();
  await expect(app.getByRole("dialog", { name: "Break time" })).toBeVisible();
});

test("break overlay survives a reload", async ({ app }) => {
  await startOneMinuteSession(app);
  await advance(app, 61_000);
  await expect(app.getByRole("dialog", { name: "Break time" })).toBeVisible();
  await app.reload();
  await expect(app.getByRole("dialog", { name: "Break time" })).toBeVisible();
});

test("parked thoughts show up at the break", async ({ app }) => {
  await startOneMinuteSession(app);
  await app.keyboard.press("Meta+Shift+p");
  const input = app.getByRole("textbox", { name: "Parking lot" });
  await input.fill("Email the tutor");
  await input.press("Enter");
  await expect(input).toBeHidden();
  await advance(app, 61_000);
  const overlay = app.getByRole("dialog", { name: "Break time" });
  await expect(overlay.getByText("Email the tutor")).toBeVisible();
});
