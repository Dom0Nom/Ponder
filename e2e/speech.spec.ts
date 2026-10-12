import { test as base, expect, type Page } from "@playwright/test";

type W = Window & {
  __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
  __mock: { db: () => { speech: { url: string; body: Record<string, unknown> | null }[] } };
  __plays: number;
};

/** No sound: play() resolves and the clip "ends" right away. */
const silentAudio = () => {
  (window as unknown as W).__plays = 0;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    (window as unknown as W).__plays++;
    setTimeout(() => this.dispatchEvent(new Event("ended")), 150);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = () => undefined;
};

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.addInitScript(silentAudio);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/?seed&openrouter");
    await page.waitForFunction(() => (window as unknown as W).__mock);
    await page.evaluate(() => (window as unknown as W).__TAURI_INTERNALS__.invoke("secret_set", { providerId: "mock-openrouter", value: "k" }));
    await use(page);
  },
});

const speech = (app: Page) => app.evaluate(() => (window as unknown as W).__mock.db().speech);

test("listen reads a chat answer aloud through OpenRouter", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  const box = app.getByLabel("Ask about your sources…");
  await box.fill("What do chloroplasts do?");
  await box.press("Enter");
  const actions = app.getByTestId("answer-actions").last();
  await expect(actions).toBeVisible();
  const listen = actions.getByTestId("listen");
  await listen.click();
  await expect.poll(() => app.evaluate(() => (window as unknown as W).__plays)).toBeGreaterThan(0);
  await expect(listen).toHaveAttribute("data-state", "idle");
  const calls = await speech(app);
  expect(calls[0].url).toBe("https://openrouter.ai/api/v1/audio/speech");
  expect(calls[0].body).toMatchObject({ model: "hexgrad/kokoro-82m", voice: "af_heart", response_format: "mp3" });
  expect(String(calls[0].body!.input)).not.toMatch(/[*#[\]]/);
});

test("voice settings: pick a model and voice, switch to a keyed service", async ({ app }) => {
  await app.evaluate(() => (window as unknown as { __ui: { getState: () => { navigate: (r: unknown) => void } } }).__ui.getState().navigate({ name: "settings" }));
  const voice = app.getByTestId("voice-settings");
  await voice.scrollIntoViewIfNeeded();
  await expect(voice.getByLabel("Voice model")).toHaveValue("hexgrad/kokoro-82m");
  await voice.getByLabel("Voice", { exact: true }).selectOption("bf_emma");
  await voice.getByRole("button", { name: "Listen" }).click();
  await expect.poll(async () => (await speech(app)).find((c) => c.url.endsWith("/audio/speech"))?.body?.voice).toBe("bf_emma");

  await voice.getByLabel("Speech service").selectOption("fish");
  await expect(voice.getByRole("button", { name: "Listen" })).toBeDisabled();
  await voice.getByLabel("Fish Audio API key").fill("fish-key");
  await voice.getByRole("button", { name: "Save key" }).click();
  await expect(voice.getByRole("button", { name: "Listen" })).toBeEnabled();
  await voice.getByRole("button", { name: "Listen" }).click();
  await expect.poll(async () => (await speech(app)).at(-1)?.url).toBe("https://api.fish.audio/v1/tts");
});
