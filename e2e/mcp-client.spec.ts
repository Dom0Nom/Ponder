import { test, expect } from "./fixtures";

test("MCP client: add a server, the tutor calls its tool, broken servers are reported", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("mcp-client");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toContainText("No servers yet.");
  await section.getByRole("button", { name: "Add server" }).click();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section).toContainText("Add the command that starts the server.");
  await section.getByLabel("Name").fill("Glossary");
  await section.getByLabel("Command").fill(`npx -y glossary-mcp "/Users/me/My Notes"`);
  await section.getByLabel("Environment variables").fill("GLOSSARY_TOKEN=abc");
  await section.getByRole("button", { name: "Save" }).click();
  const row = section.locator('[data-testid="mcp-server"][data-name="Glossary"]');
  await expect(row).toBeVisible();
  await expect(section).toContainText("npx -y glossary-mcp '/Users/me/My Notes'");
  await row.getByRole("button", { name: "Test" }).click();
  await expect(section.getByTestId("mcp-tool-count")).toHaveText("1 tool");
  const db = () => app.evaluate(() => (window as any).__mock.db());
  const saved = await db();
  const server = (saved.settings["mcp.servers"] as { id: string; args: string[] }[])[0];
  expect(server.args).toEqual(["-y", "glossary-mcp", "/Users/me/My Notes"]);
  expect(saved.secrets[`mcp-env:${server.id}`]).toBe(true);

  await app.evaluate(() => (window as any).__ui.getState().navigate({ name: "home" }));
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Biology");
  await app.getByRole("button", { name: "Create" }).click();
  const box = app.getByLabel("Ask about your sources…");
  await box.fill("What does my glossary say about osmosis?");
  await box.press("Enter");
  const answer = app.getByTestId("message-list");
  await expect(answer).toContainText("From your glossary: osmosis: water moving across a membrane");
  await expect(app.getByTestId("tool-chips").last()).toHaveText("Used lookup from Glossary");
  expect((await db()).mcpCalls).toEqual([{ server: server.id, tool: "lookup", arguments: { term: "osmosis" } }]);

  await app.evaluate(() => {
    const st = (window as any).__mock.db().settings;
    st["mcp.servers"] = [...st["mcp.servers"], { id: "x", name: "Broken", command: "missing-server", args: [], enabled: true }];
  });
  await box.fill("And what is diffusion?");
  await box.press("Enter");
  await expect(app.getByTestId("tool-chips").last()).toContainText("Tools unavailable: Broken: Couldn't start missing-server");
});
