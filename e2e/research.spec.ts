import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

type Call = { model: string; system: string; user: string };

async function record(app: Page) {
  await app.evaluate(() => {
    const w = window as unknown as { __calls: Call[]; __mock: { setScript: (f: unknown) => void } };
    w.__calls = [];
    w.__mock.setScript(({ messages, body }: { messages: { role: string; content: unknown }[]; body: { model: string } }) => {
      const text = (m?: { content: unknown }) => (typeof m?.content === "string" ? m.content : (JSON.stringify(m?.content) ?? ""));
      const system = text(messages.find((m) => m.role === "system"));
      const user = text(messages.filter((m) => m.role === "user").at(-1));
      w.__calls.push({ model: body.model, system, user });
      return {
        content: user.includes("Study space") ? "Cell biology and genetics basics" : '{"language":"en","queries":["cell biology"]}',
      };
    });
  });
}

const calls = async (app: Page) =>
  (await app.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)).filter(
    (c) => c.user.includes("Study space") || c.user.includes("A learner wants"),
  );

async function newSpace(app: Page, name: string) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill(name);
  await app.getByRole("button", { name: "Create" }).click();
}

async function addNote(app: Page, title: string) {
  await app.getByRole("button", { name: "Add source" }).first().click();
  await app.getByRole("tab", { name: "Paste text" }).click();
  await app.getByLabel("Title").fill(title);
  await app.getByRole("textbox", { name: "Text", exact: true }).fill(`${title} notes about cells.`);
  await app.getByRole("button", { name: "Import" }).click();
}

const dialog = (app: Page) => app.getByRole("dialog", { name: "Add a source" });
const query = (app: Page) => dialog(app).getByRole("textbox", { name: "What do you want to learn about?" });

test("deep research opens from the sources panel with the query prefilled and cached", async ({ app }) => {
  await newSpace(app, "Biology");
  await addNote(app, "Mitosis notes");
  await addNote(app, "Cell membranes");
  await record(app);

  await app.getByTestId("find-sources").click();
  await expect(dialog(app).getByRole("tab", { name: "Deep research" })).toHaveAttribute("aria-selected", "true");
  await expect(query(app)).toHaveValue("Cell biology and genetics basics");
  const first = await calls(app);
  expect(first).toHaveLength(1);
  expect(first[0].user).toContain("Mitosis notes");
  expect(first[0].user).toContain("Cell membranes");
  expect(first[0].user).toContain("Biology");

  await app.keyboard.press("Escape");
  await app.getByTestId("find-sources").click();
  await expect(query(app)).toHaveValue("Cell biology and genetics basics");
  expect(await calls(app)).toHaveLength(1);

  await query(app).fill("my own question");
  await dialog(app).getByRole("button", { name: "Suggest another question" }).click();
  await expect(query(app)).toHaveValue("Cell biology and genetics basics");
  expect(await calls(app)).toHaveLength(2);
});

test("deep research opens from an empty space", async ({ app }) => {
  await newSpace(app, "Chemistry");
  await record(app);
  await app.getByTestId("chat-empty").getByRole("button", { name: "Find sources" }).click();
  await expect(query(app)).toHaveValue("Cell biology and genetics basics");
  expect((await calls(app))[0].user).toContain("Chemistry");
});

test("settings: separate research model and system prompt are used and can be reset", async ({ app }) => {
  await newSpace(app, "Biology");
  await record(app);
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  const section = app.locator("#settings-research");
  await expect(section.getByRole("combobox", { name: "Model" })).toHaveValue("");
  await expect(section.getByRole("combobox", { name: "Model" }).locator("option").first()).toHaveText("Same as chat model");

  const prompt = section.getByRole("textbox", { name: "Instructions for the source-finding agent" });
  await expect(prompt).toHaveValue(/research assistant that finds study sources/);
  await expect(section.getByRole("button", { name: "Reset to default" })).toBeDisabled();

  await section.getByRole("combobox", { name: "Model" }).selectOption({ label: "Other model id…" });
  await section.getByPlaceholder(/Model id/).fill("research-model-9");
  await section.getByPlaceholder(/Model id/).press("Enter");
  await prompt.fill("Only peer-reviewed papers.");
  await prompt.blur();
  await expect(section.getByRole("button", { name: "Reset to default" })).toBeEnabled();

  await app.getByRole("button", { name: "Back" }).click();
  await app.getByRole("button", { name: "Add source" }).first().click();
  await dialog(app).getByRole("tab", { name: "Deep research" }).click();
  await expect(query(app)).toHaveValue("Cell biology and genetics basics");
  await query(app).fill("mitosis");
  await dialog(app).getByRole("button", { name: "Research" }).click();
  await expect.poll(async () => (await calls(app)).length).toBeGreaterThanOrEqual(2);
  const all = await calls(app);
  for (const c of all) {
    expect(c.model).toBe("research-model-9");
    expect(c.system).toBe("Only peer-reviewed papers.");
  }

  await app.keyboard.press("Escape");
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  await section.getByRole("button", { name: "Reset to default" }).click();
  await expect(prompt).toHaveValue(/research assistant that finds study sources/);
  await expect(section.getByRole("button", { name: "Reset to default" })).toBeDisabled();
});
