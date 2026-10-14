import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function space(app: Page) {
  await app.getByRole("button", { name: "New space" }).first().click();
  await app.getByLabel("Name").fill("Coding");
  await app.getByRole("button", { name: "Create" }).click();
}

async function answerWith(app: Page, content: string) {
  await app.evaluate((c) => (window as any).__mock.setScript(() => ({ content: c })), content);
  const box = app.getByLabel("Ask about your sources…");
  await box.fill("Show me");
  await box.press("Enter");
  await expect(app.getByTestId("msg-assistant").last()).toBeVisible({ timeout: 30_000 });
}

test("code cells: JavaScript runs in a worker without network access", async ({ app }) => {
  await space(app);
  await answerWith(
    app,
    [
      "Here is a loop:",
      "```js",
      "const xs = [1, 2, 3].map((x) => x * x);",
      "console.log(xs, { sum: xs.reduce((a, b) => a + b) });",
      "console.log(typeof fetch, typeof XMLHttpRequest, typeof WebSocket);",
      "```",
      "And an error:",
      "```javascript",
      "console.log('before');",
      "null.x;",
      "```",
      "And a loop that never ends:",
      "```js",
      "while (true) {}",
      "```",
      "Bash is not runnable:",
      "```bash",
      "echo hi",
      "```",
    ].join("\n"),
  );
  const cells = app.getByTestId("code-cell");
  await expect(cells).toHaveCount(3);
  await expect(app.getByTestId("msg-assistant").last().locator("pre")).toHaveCount(4);

  await cells.nth(0).getByTestId("cell-run").click();
  const out0 = cells.nth(0).getByTestId("cell-output");
  await expect(out0).toHaveAttribute("data-ok", "true");
  await expect(out0.getByTestId("cell-text")).toHaveText('[1,4,9] {"sum":14}\nundefined undefined undefined');

  await cells.nth(1).getByTestId("cell-run").click();
  const out1 = cells.nth(1).getByTestId("cell-output");
  await expect(out1).toHaveAttribute("data-ok", "false");
  await expect(out1.getByTestId("cell-text")).toContainText("before");
  await expect(out1.getByTestId("cell-text")).toContainText("TypeError");

  await cells.nth(2).getByTestId("cell-run").click();
  await expect(cells.nth(2)).toHaveAttribute("data-state", "running");
  await expect(cells.nth(2).getByTestId("cell-output")).toContainText("Stopped after 5 s", { timeout: 15_000 });
  await expect(app.getByTestId("msg-assistant").last()).toBeVisible({ timeout: 30_000 });

  await out0.getByRole("button", { name: "Clear output" }).click();
  await expect(out0).toHaveCount(0);
});

test("code cells: Python runs offline in Pyodide and keeps state between cells", async ({ app }) => {
  test.setTimeout(240_000);
  const external: string[] = [];
  app.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("blob") && !u.protocol.startsWith("data")) external.push(r.url());
  });
  await space(app);
  await answerWith(
    app,
    ["```python", "import math", "def area(r):", "    return math.pi * r ** 2", "print(round(area(2), 3))", "```", "Then:", "```py", "area(1) * 2", "```", "Broken:", "```python", "1 / 0", "```"].join("\n"),
  );
  const cells = app.getByTestId("code-cell");
  await expect(cells).toHaveCount(3);
  await cells.nth(0).getByTestId("cell-run").click();
  await expect(cells.nth(0)).toContainText("Loading Python");
  await expect(cells.nth(0).getByTestId("cell-text")).toHaveText("12.566", { timeout: 180_000 });
  await cells.nth(1).getByTestId("cell-run").click();
  await expect(cells.nth(1).getByTestId("cell-text")).toHaveText("6.283185307179586");
  await cells.nth(2).getByTestId("cell-run").click();
  await expect(cells.nth(2).getByTestId("cell-output")).toHaveAttribute("data-ok", "false");
  await expect(cells.nth(2).getByTestId("cell-text")).toContainText("ZeroDivisionError");
  expect(external).toEqual([]);
});

test("code cells: C blocks run through the compiler command with stdin and inline errors", async ({ app }) => {
  await space(app);
  await answerWith(
    app,
    [
      "Hello:",
      "```c",
      "#include <stdio.h>",
      'int main(void) { printf("hello\\n"); return 0; }',
      "```",
      "Broken:",
      "```c",
      "int main(void) {",
      "  int x = ;",
      "  return 0;",
      "}",
      "```",
      "Never ends:",
      "```c",
      "int main(void) { for (;;) {} }",
      "```",
    ].join("\n"),
  );
  const cells = app.getByTestId("code-cell");
  await expect(cells).toHaveCount(3);
  await expect(cells.nth(0)).toHaveAttribute("data-lang", "c");

  await cells.nth(0).getByTestId("c-input-toggle").click();
  await cells.nth(0).getByTestId("c-stdin").fill("typed input");
  await cells.nth(0).getByTestId("cell-run").click();
  await expect(cells.nth(0).getByTestId("cell-output")).toHaveAttribute("data-ok", "true");
  await expect(cells.nth(0).getByTestId("cell-text")).toContainText("hello");
  await expect(cells.nth(0).getByTestId("cell-text")).toContainText("typed input");

  await cells.nth(1).getByTestId("cell-run").click();
  await expect(cells.nth(1).getByTestId("cell-output")).toHaveAttribute("data-stage", "compile");
  await expect(cells.nth(1).getByTestId("c-diagnostics")).toContainText("Line 2: expected expression");

  await cells.nth(2).getByTestId("cell-run").click();
  await expect(cells.nth(2).getByTestId("cell-text")).toContainText("Stopped after 5 seconds");
});

test("code cells: NumPy, Matplotlib and SymPy load from the bundle and figures show as output", async ({ app }) => {
  test.setTimeout(600_000);
  const external: string[] = [];
  app.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("blob") && !u.protocol.startsWith("data")) external.push(r.url());
  });
  await space(app);
  await answerWith(
    app,
    [
      "```python",
      "import numpy as np",
      "print(np.arange(6).reshape(2, 3).sum(axis=1))",
      "```",
      "Plot:",
      "```python",
      "import numpy as np",
      "import matplotlib.pyplot as plt",
      "x = np.linspace(0, 6, 50)",
      "plt.plot(x, np.sin(x))",
      "plt.title('sine')",
      "```",
      "Symbolic:",
      "```python",
      "import sympy as sp",
      "x = sp.symbols('x')",
      "print(sp.diff(x * sp.sin(x), x))",
      "```",
    ].join("\n"),
  );
  const cells = app.getByTestId("code-cell");
  await expect(cells).toHaveCount(3);
  await cells.nth(0).getByTestId("cell-run").click();
  await expect(cells.nth(0).getByTestId("cell-text")).toHaveText("[ 3 12]", { timeout: 400_000 });
  await cells.nth(1).getByTestId("cell-run").click();
  await expect(cells.nth(1).getByTestId("cell-figure")).toBeVisible({ timeout: 400_000 });
  expect(await cells.nth(1).getByTestId("cell-figure").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
  await cells.nth(2).getByTestId("cell-run").click();
  await expect(cells.nth(2).getByTestId("cell-text")).toHaveText("x*cos(x) + sin(x)", { timeout: 400_000 });
  expect(external).toEqual([]);
});
