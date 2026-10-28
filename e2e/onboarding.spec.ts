import { test as base, expect, type Page } from "@playwright/test";

const test = base.extend<{ ob: Page }>({
  ob: async ({ page }, use) => {
    await page.goto("/");
    await page.getByRole("main").waitFor({ timeout: 60_000 });
    await page.evaluate(() => localStorage.clear());
    await page.goto("/?onboarding");
    await use(page);
  },
});

test.setTimeout(90_000);

const wizard = (p: Page) => p.getByTestId("onboarding");
const next = (p: Page) => wizard(p).getByRole("button", { name: /^(Continue|Weiter)$/ }).click();
const heading = (p: Page, name: string) => expect(wizard(p).getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 15_000 });

async function toStep(p: Page, n: number) {
  for (let i = 0; i < n; i++) await next(p);
}

test("shows on first launch and is skippable", async ({ ob }) => {
  await heading(ob, "Welcome to Ponder");
  await expect(wizard(ob).getByRole("button", { name: "Back" })).toBeDisabled();
  await wizard(ob).getByRole("button", { name: "Skip setup" }).click();
  await expect(wizard(ob)).toHaveCount(0);
  await ob.reload();
  await expect(wizard(ob)).toHaveCount(0);
});

test("welcome settings apply immediately", async ({ ob }) => {
  await wizard(ob).getByRole("radio", { name: "Dark" }).click();
  await expect(ob.locator("html")).toHaveAttribute("data-theme", "dark");
  await wizard(ob).getByRole("radio", { name: "OpenDyslexic" }).click();
  await expect(ob.locator("html")).toHaveAttribute("data-font", "dyslexic");
  await wizard(ob).getByLabel("Language").selectOption("de");
  await expect(ob.locator("html")).toHaveAttribute("lang", "de");
  await expect(wizard(ob).getByRole("button", { name: "Zurück" })).toBeVisible();
});

test("Back goes to the previous step and keeps choices", async ({ ob }) => {
  await wizard(ob).getByRole("radio", { name: "Dark" }).click();
  await toStep(ob, 1);
  await heading(ob, "How should Ponder talk to AI?");
  await wizard(ob).getByRole("button", { name: "Back" }).click();
  await heading(ob, "Welcome to Ponder");
  await expect(wizard(ob).getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
});

test("AI: skip for now moves on and leaves no provider", async ({ ob }) => {
  await toStep(ob, 1);
  await wizard(ob).getByRole("button", { name: "Skip for now" }).click();
  await heading(ob, "Search model");
  expect(await ob.evaluate(() => Object.keys((window as any).__mock.db().providers).length)).toBe(0);
});

test("AI: every path says cost, what leaves the computer and what it needs", async ({ ob }) => {
  await toStep(ob, 1);
  for (const id of ["ai-subscription", "ai-key", "ai-local"]) {
    const card = ob.getByTestId(id);
    await expect(card.getByText("Cost", { exact: true })).toBeVisible();
    await expect(card.getByText("Leaves your computer", { exact: true })).toBeVisible();
    await expect(card.getByText("Needs", { exact: true })).toBeVisible();
  }
});

test("AI: API key is tested for real, saved and a model is recommended", async ({ ob }) => {
  await toStep(ob, 1);
  const card = ob.getByTestId("ai-key");
  await card.getByLabel("API key").fill("sk-or-test");
  await card.getByRole("button", { name: "Test and save" }).click();
  const list = ob.getByTestId("ai-connected");
  await expect(list.getByRole("listitem", { name: "OpenRouter" })).toBeVisible();
  await expect(list.getByRole("combobox")).toContainText("(recommended)");
  const db = await ob.evaluate(() => {
    const d = (window as any).__mock.db();
    return { secrets: Object.keys(d.secrets).length, providers: Object.values(d.providers).map((p: any) => p.type), model: d.settings.defaultModel };
  });
  expect(db.providers).toEqual(["openrouter"]);
  expect(db.secrets).toBe(1);
  expect(db.model.model).toBe("mock-model");
});

test("AI: an unreachable server shows the error and keeps nothing", async ({ ob }) => {
  await toStep(ob, 1);
  const card = ob.getByTestId("ai-local");
  await card.getByLabel("Or enter an address").fill("http://down.local:1234/v1");
  await card.getByRole("button", { name: "Connect" }).last().click();
  await expect(card.getByRole("alert")).toContainText("Couldn't connect");
  await expect.poll(() => ob.evaluate(() => Object.keys((window as any).__mock.db().providers).length)).toBe(0);
});

test("AI: local server found on the network is connected and tested", async ({ ob }) => {
  await toStep(ob, 1);
  const card = ob.getByTestId("ai-local");
  await card.getByRole("button", { name: "Find on my network" }).click();
  const row = card.getByRole("listitem");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Connect" }).click();
  await expect(ob.getByTestId("ai-connected").getByRole("listitem", { name: /LM Studio/ })).toBeVisible();
});

test("AI: ChatGPT sign-in starts and hands off to the browser", async ({ ob }) => {
  await toStep(ob, 1);
  await ob.getByRole("button", { name: "Sign in with ChatGPT" }).click();
  await expect(ob.getByTestId("ai-subscription").getByRole("status")).toBeVisible();
  const types = await ob.evaluate(() => Object.values((window as any).__mock.db().providers).map((p: any) => p.type));
  expect(types).toEqual(["chatgpt-oauth"]);
  await expect(ob.getByTestId("ai-connected").getByRole("listitem", { name: /ChatGPT/ })).toBeVisible({ timeout: 10_000 });
});

test("AI: Grok shows the device code", async ({ ob }) => {
  await toStep(ob, 1);
  await ob.getByRole("button", { name: "Sign in with Grok" }).click();
  await expect(ob.getByTestId("device-code")).toHaveText("WDJB-MJHT");
});

test("search step downloads the suggested model and shows progress then ready", async ({ ob }) => {
  await toStep(ob, 2);
  await heading(ob, "Search model");
  await expect(ob.getByRole("radio", { name: /^English/ })).toHaveAttribute("aria-checked", "true");
  await ob.getByRole("radio", { name: /^Multilingual/ }).click();
  await expect(ob.getByTestId("search-progress")).toBeVisible();
  await expect(ob.getByTestId("search-progress").getByText("Ready")).toBeVisible();
  expect(await ob.evaluate(() => (window as any).__mock.db().settings.embeddingModel)).toBe("multilingual-e5-small");
});

test("a non-English app language suggests the multilingual model", async ({ ob }) => {
  await wizard(ob).getByLabel("Language").selectOption("de");
  await expect(ob.locator("html")).toHaveAttribute("lang", "de");
  await toStep(ob, 2);
  await expect.poll(() => ob.evaluate(() => (window as any).__mock.db().settings.embeddingModel)).toBe("multilingual-e5-small");
});

test("voice: on this computer saves the local service", async ({ ob }) => {
  await toStep(ob, 3);
  await ob.getByRole("radio", { name: /^On this computer/ }).click();
  await expect.poll(() => ob.evaluate(() => (window as any).__mock.db().settings.speech?.service)).toBe("local");
});

test("space step creates the space with a plan and the wizard resumes where it stopped", async ({ ob }) => {
  await toStep(ob, 4);
  await ob.getByLabel("Name", { exact: true }).fill("GED Math");
  await ob.getByLabel("What do you want to reach?").fill("Pass the math section");
  await ob.getByLabel("Exam date").fill("2027-03-01");
  await ob.getByRole("button", { name: "Create space" }).click();
  await expect(ob.getByRole("button", { name: "Save changes" })).toBeVisible();
  const n = await ob.evaluate(() => {
    const d = (window as any).__mock.db();
    return { spaces: Object.values(d.spaces).map((s: any) => s.name), plans: Object.keys(d.plans ?? d.studyPlans ?? {}).length };
  });
  expect(n.spaces).toEqual(["GED Math"]);

  await ob.reload();
  await heading(ob, "Your first space");
  await expect(ob.getByLabel("Name", { exact: true })).toHaveValue("GED Math");
});

test("a skill goal is saved as a goal, not a setting", async ({ ob }) => {
  await toStep(ob, 4);
  await ob.getByLabel("Name", { exact: true }).fill("Guitar");
  await wizard(ob).getByRole("radio", { name: "A skill" }).click();
  await ob.getByLabel("What do you want to reach?").fill("Play three songs");
  await ob.getByRole("button", { name: "Create space" }).click();
  await expect(ob.getByRole("button", { name: "Save changes" })).toBeVisible();
  const d = await ob.evaluate(() => {
    const db = (window as any).__mock.db();
    return { goals: Object.values(db.goals ?? {}), keys: Object.keys(db.settings).filter((k) => k.startsWith("onboardingGoal.")) };
  });
  expect(d.goals).toMatchObject([{ kind: "skill", title: "Play three songs", graph: { nodes: [] } }]);
  expect(d.keys).toEqual([]);
  await ob.reload();
  await heading(ob, "Your first space");
  await expect(ob.getByLabel("What do you want to reach?")).toHaveValue("Play three songs");
});

test("the Help menu event starts the welcome tour", async ({ ob }) => {
  await ob.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("create_space", { input: { name: "Tour" } }));
  await ob.reload();
  await expect(ob.getByTestId("space-card")).toBeVisible();
  await ob.evaluate(() => (window as any).__mock.emit("help://tour", null));
  await expect(ob.getByTestId("tour-mark")).toBeVisible();
});

test("resumes after a reload", async ({ ob }) => {
  await toStep(ob, 3);
  await heading(ob, "Voice");
  await ob.reload();
  await heading(ob, "Voice");
});

test("finishing opens the space with the tour, and setup never shows again", async ({ ob }) => {
  await toStep(ob, 4);
  await ob.getByLabel("Name", { exact: true }).fill("Biology");
  await ob.getByRole("button", { name: "Create space" }).click();
  await expect(ob.getByRole("button", { name: "Save changes" })).toBeVisible();
  await toStep(ob, 1);
  await heading(ob, "How you study");
  await expect(wizard(ob).getByRole("switch", { name: "Forced breaks" })).toBeChecked();
  await wizard(ob).getByRole("button", { name: "Start learning" }).click();
  await expect(wizard(ob)).toHaveCount(0);
  const mark = ob.getByTestId("tour-mark");
  await expect(mark).toBeVisible();
  await expect(mark.getByText("Chat")).toBeVisible();
  await mark.getByRole("button", { name: "Next" }).click();
  await expect(ob.getByTestId("tour-mark").getByText("Sources", { exact: true })).toBeVisible();
  await ob.keyboard.press("Escape");
  await expect(ob.getByTestId("tour-mark")).toHaveCount(0);
  await ob.reload();
  await expect(wizard(ob)).toHaveCount(0);
});

test("forced breaks can be turned off from the study step", async ({ ob }) => {
  await toStep(ob, 5);
  await wizard(ob).getByRole("switch", { name: "Forced breaks" }).click();
  expect(await ob.evaluate(() => (window as any).__mock.db().settings["focus.forcedBreaks"])).toEqual({ enabled: false });
});

test("works in Arabic: right-to-left and every step reachable by keyboard", async ({ ob }) => {
  await wizard(ob).getByLabel("Language").selectOption("ar");
  await expect(ob.locator("html")).toHaveAttribute("dir", "rtl");
  const nav = wizard(ob).getByRole("list", { name: /./ }).first();
  const box = await nav.boundingBox();
  expect(box!.x + box!.width / 2).toBeLessThan(ob.viewportSize()!.width);
  const progress = wizard(ob).locator("ol li").first();
  const first = await progress.boundingBox();
  const lastItem = await wizard(ob).locator("ol li").last().boundingBox();
  expect(first!.x).toBeGreaterThan(lastItem!.x);
  await ob.keyboard.press("Tab");
  expect(await ob.evaluate(() => document.activeElement?.tagName)).toBeTruthy();
});

test("never shows when a space already exists", async ({ ob }) => {
  await ob.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("create_space", { input: { name: "Existing" } }));
  await ob.reload();
  await expect(ob.getByTestId("space-card")).toBeVisible();
  await expect(wizard(ob)).toHaveCount(0);
});

test("Run setup again in Settings reopens the wizard", async ({ ob }) => {
  await wizard(ob).getByRole("button", { name: "Skip setup" }).click();
  await expect(wizard(ob)).toHaveCount(0);
  await ob.getByRole("button", { name: "Settings" }).first().click();
  await ob.getByRole("button", { name: "Run setup again" }).click();
  await heading(ob, "Welcome to Ponder");
});

test("the default mock state is already set up", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?seed");
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
});
