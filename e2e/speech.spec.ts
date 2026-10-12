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

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone"] });

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

test("audio overview: two voices, line navigation, a question, transcript export", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Photosynthesis notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill("Photosynthesis happens in the chloroplasts. The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar in the stroma.");
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);

  await app.getByTestId("create-row").click();
  const panel = app.getByTestId("create-panel");
  await panel.locator('[data-kind="audio"]').click();
  await panel.getByTestId("audio-styles").locator('[data-style="brief"]').click();

  const screen = app.getByTestId("output-screen");
  await expect(screen.getByRole("heading", { level: 1 })).toHaveText("How leaves make sugar");
  const transcript = screen.getByTestId("audio-transcript");
  await expect(transcript.locator("> li")).toHaveCount(6);
  await expect(transcript).toContainText("Host 2");

  await screen.getByRole("button", { name: "Next line" }).click();
  await expect(screen.getByTestId("audio-position")).toHaveText(/Line 2 of 6/);
  await expect.poll(async () => (await speech(app)).filter((c) => c.url.endsWith("/audio/speech")).length).toBeGreaterThanOrEqual(5);
  const voices = (await speech(app)).filter((c) => c.url.endsWith("/audio/speech")).map((c) => c.body!.voice);
  expect(voices.slice(0, 2)).toEqual(["am_adam", "af_heart"]);
  await expect(screen.getByTestId("audio-play")).toHaveText("Play", { timeout: 10_000 });

  await screen.getByLabel("Ask the hosts").fill("Where does the Calvin cycle happen?");
  await screen.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(screen.getByTestId("audio-aside")).toContainText("stroma");

  await screen.getByTestId("output-export").click();
  await app.getByRole("menuitem", { name: "Markdown (.md)" }).click();
  await expect(app.getByText("Saved to /Users/me/Downloads/How leaves make sugar.md")).toBeVisible();
});

test("daily briefing on Home: written from today's facts and read aloud", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  await app.getByRole("button", { name: "Add source" }).click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill("Leaf notes");
  await app.getByRole("textbox", { name: "Text", exact: true }).fill("Photosynthesis happens in the chloroplasts.");
  await app.getByRole("button", { name: "Import" }).click();
  await expect(app.locator('[data-testid="source-row"][data-status="ready"]')).toHaveCount(1);

  await app.evaluate(() => (window as unknown as { __ui: { getState: () => { navigate: (r: unknown) => void } } }).__ui.getState().navigate({ name: "home" }));
  const briefing = app.getByTestId("briefing");
  await expect(briefing).toHaveText("Today's briefing");
  await briefing.click();
  await expect.poll(async () => (await speech(app)).map((c) => String(c.body?.input ?? "")).join(" ")).toContain("Calvin cycle");
  await expect(briefing).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
});

test("dictation records from the microphone and puts the transcript in the composer", async ({ app }) => {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  const box = app.getByLabel("Ask about your sources…");
  await box.fill("Question:");
  const mic = app.getByTestId("dictate");
  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "recording");
  await app.waitForTimeout(600);
  await mic.click();
  await expect(box).toHaveValue("Question: Chloroplasts capture light energy.");
  await expect(mic).toHaveAttribute("data-state", "idle");
  const call = (await speech(app)).find((c) => c.url.endsWith("/audio/transcriptions"));
  expect(call?.body).toMatchObject({ model: "openai/whisper-large-v3-turbo", input_audio: { format: "webm" } });
});
