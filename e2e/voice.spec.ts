import { test as base, expect, type Page } from "@playwright/test";

type W = Window & {
  __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
  __mock: { db: () => { speech: { url: string; body: Record<string, unknown> | null }[] } };
  __plays: number;
  __clipMs: number;
  __level: number;
};

/** No sound: play() resolves and the clip "ends" after `__clipMs`; the mic level meter reads `__level`. */
const fakeAudio = () => {
  const w = window as unknown as W;
  w.__plays = 0;
  w.__clipMs = 150;
  w.__level = 0.001;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    w.__plays++;
    setTimeout(() => this.dispatchEvent(new Event("ended")), w.__clipMs);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = () => undefined;
  AnalyserNode.prototype.getFloatTimeDomainData = function (a: Float32Array) {
    a.fill(w.__level);
  };
};

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.addInitScript(fakeAudio);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/?seed&openrouter");
    await page.waitForFunction(() => (window as unknown as W).__mock);
    await page.evaluate(() => (window as unknown as W).__TAURI_INTERNALS__.invoke("secret_set", { providerId: "mock-openrouter", value: "k" }));
    await use(page);
  },
});

test.use({ launchOptions: { args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone"] });

const speech = (app: Page) => app.evaluate(() => (window as unknown as W).__mock.db().speech);

async function space(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
}

const bar = (app: Page) => app.getByTestId("voice-bar");

test("voice tutor: speak, get a spoken answer in the thread, then listen again", async ({ app }) => {
  await space(app);
  await app.getByTestId("voice-start").click();
  await expect(bar(app)).toHaveAttribute("data-phase", "listening");
  await expect(app.getByTestId("voice-status")).toHaveText("Listening…");
  await expect(app.getByLabel("Ask about your sources…")).toBeHidden();
  await app.waitForTimeout(500);

  await app.evaluate(() => ((window as unknown as W).__clipMs = 1500));
  await app.getByTestId("voice-mic").click();
  await expect(bar(app)).toHaveAttribute("data-phase", "speaking");
  await expect(app.getByTestId("voice-line")).toHaveText("You: Chloroplasts capture light energy.");

  const messages = app.getByTestId("message-list");
  await expect(messages).toContainText("Chloroplasts capture light energy.");
  await expect(messages).toContainText("do you think that happens");

  const tts = (await speech(app)).filter((c) => c.url.endsWith("/audio/speech"));
  expect(tts.length).toBeGreaterThan(0);
  const spoken = tts.map((c) => String(c.body!.input)).join(" ");
  expect(spoken).toContain("do you think that happens");
  expect(spoken).not.toMatch(/[*[\]{}]/);

  await expect(bar(app)).toHaveAttribute("data-phase", "listening", { timeout: 10_000 });
  await app.getByTestId("voice-stop").click();
  await expect(bar(app)).toHaveCount(0);
  await expect(app.getByLabel("Ask about your sources…")).toBeVisible();
});

test("voice tutor: pressing the mic while it speaks interrupts and listens", async ({ app }) => {
  await space(app);
  await app.evaluate(() => ((window as unknown as W).__clipMs = 30_000));
  await app.getByTestId("voice-start").click();
  await app.waitForTimeout(400);
  await app.getByTestId("voice-mic").click();
  await expect(bar(app)).toHaveAttribute("data-phase", "speaking");
  await expect(app.getByRole("button", { name: "Interrupt and speak" })).toBeEnabled();
  await app.getByTestId("voice-mic").click();
  await expect(bar(app)).toHaveAttribute("data-phase", "listening");
  await app.keyboard.press("Escape");
  await expect(bar(app)).toHaveCount(0);
});

test("voice tutor: ends the take after the learner stops talking", async ({ app }) => {
  await space(app);
  await app.getByTestId("voice-start").click();
  await expect(bar(app)).toHaveAttribute("data-phase", "listening");
  await app.evaluate(() => ((window as unknown as W).__level = 0.1));
  await app.waitForTimeout(700);
  await app.evaluate(() => ((window as unknown as W).__level = 0.001));
  const t0 = Date.now();
  await expect(bar(app)).not.toHaveAttribute("data-phase", "listening", { timeout: 6000 });
  expect(Date.now() - t0).toBeGreaterThan(1000);
  await expect(app.getByTestId("message-list")).toContainText("Chloroplasts capture light energy.");
  await app.getByTestId("voice-stop").click();
});

test("voice tutor: Esc ends it while listening", async ({ app }) => {
  await space(app);
  await app.getByTestId("voice-start").click();
  await expect(bar(app)).toHaveAttribute("data-phase", "listening");
  await app.keyboard.press("Escape");
  await expect(bar(app)).toHaveCount(0);
  await expect(app.getByLabel("Ask about your sources…")).toBeVisible();
});

test("the voice button is hidden without a speech service", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?seed");
  await page.getByRole("button", { name: "New space" }).first().click();
  await page.getByLabel("Name").fill("Biology");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Ask about your sources…")).toBeVisible();
  await expect(page.getByTestId("voice-start")).toHaveCount(0);
});

test("explain it back by voice: dictation fills the explanation and the follow-up answer", async ({ app }) => {
  await space(app);
  await app.keyboard.press("Meta+k");
  await app.getByRole("option", { name: "Explain it back" }).click();
  const panel = app.getByTestId("feynman-panel");
  await panel.getByLabel("Topic").fill("Photosynthesis");
  const text = panel.getByTestId("feynman-text");
  for (let i = 0; i < 3; i++) {
    const mic = panel.getByTestId("dictate");
    await mic.click();
    await expect(mic).toHaveAttribute("data-state", "recording");
    await app.waitForTimeout(400);
    await mic.click();
    await expect(mic).toHaveAttribute("data-state", "idle");
  }
  await expect(text).toHaveValue("Chloroplasts capture light energy. Chloroplasts capture light energy. Chloroplasts capture light energy.");
  await text.fill(`${await text.inputValue()} Edited by hand.`);
  await expect(panel.getByTestId("feynman-check")).toBeEnabled();
  await panel.getByTestId("feynman-check").click();
  const fb = panel.getByTestId("feynman-feedback");
  await expect(fb.getByTestId("feynman-question")).toBeVisible();
  const mic = fb.getByTestId("feynman-question").getByTestId("dictate");
  await mic.click();
  await app.waitForTimeout(400);
  await mic.click();
  await expect(fb.getByTestId("feynman-answer")).toHaveValue("Chloroplasts capture light energy.");
  await fb.getByTestId("feynman-question").getByTestId("listen").click();
  await expect.poll(async () => (await speech(app)).some((c) => c.url.endsWith("/audio/speech"))).toBe(true);
});
