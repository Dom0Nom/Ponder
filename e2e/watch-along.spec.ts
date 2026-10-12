import { test, expect } from "./fixtures";

type W = {
  __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
  __mock: {
    setScript: (fn: ((x: { messages: { content: unknown }[] }) => { content: string }) | null) => void;
    db: () => { mistakes: Record<string, { question: string; given: string; origin: string }> };
  };
};

const paras = Array.from({ length: 12 }, (_, i) => `[${Math.floor((i * 50) / 60)}:${String((i * 50) % 60).padStart(2, "0")}] Part ${i} explains step ${i} of mitosis.`);
const TRANSCRIPT = `# Mitosis explained\n\nYouTube: https://www.youtube.com/watch?v=abcdefghijk\n\n${paras.join("\n\n")}`;

test("watch along pauses for a question, checks the answer and records a miss", async ({ app }) => {
  await app.waitForFunction(() => !!(window as unknown as { __mock?: unknown }).__mock);
  await app.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>player</p>" }));
  await app.evaluate(async (text) => {
    const w = window as unknown as W;
    const sp = (await w.__TAURI_INTERNALS__.invoke("create_space", { input: { name: "Biology" } })) as { id: string };
    await w.__TAURI_INTERNALS__.invoke("import_text", { spaceId: sp.id, title: "Mitosis explained", text, kind: "youtube", origin: "https://www.youtube.com/watch?v=abcdefghijk" });
    await new Promise((r) => setTimeout(r, 600));
  }, TRANSCRIPT);
  await app.reload();
  await app.waitForFunction(() => !!(window as unknown as { __mock?: unknown }).__mock);
  await app.evaluate(() => {
    const w = window as unknown as W;
    let checks = 0;
    w.__mock.setScript(({ messages }) => {
      const c = messages[messages.length - 1]?.content;
      const last = typeof c === "string" ? c : JSON.stringify(c ?? "");
      if (/Ask one short question/.test(last)) return { content: '{"question": "What happens in step 1?", "answer": "The chromosomes condense."}' };
      if (/Judge the answer/.test(last)) {
        checks++;
        return { content: checks === 1 ? '{"correct": false, "feedback": "Not quite: the chromosomes condense."}' : '{"correct": true, "feedback": "Right."}' };
      }
      return { content: "ok" };
    });
  });
  await app.getByRole("heading", { name: "Biology" }).click();
  await app.getByRole("button", { name: /^Sources/ }).click();
  await app.locator('[data-testid="source-row"][data-status="ready"]').click();
  await app.getByRole("button", { name: "Watch along" }).click();
  const panel = app.getByTestId("watch-along");
  await expect(panel.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/abcdefghijk\?enablejsapi=1/);
  await expect(panel.getByTestId("watch-status")).toContainText("Question 1 of 2 comes at 4:10");

  await panel.getByTestId("watch-ask-now").click();
  const q = panel.getByTestId("watch-question");
  await expect(q).toContainText("What happens in step 1?");
  await q.getByLabel("Your answer").fill("They split");
  await q.getByRole("button", { name: "Check" }).click();
  await expect(q.getByTestId("watch-feedback")).toHaveAttribute("data-correct", "false");
  await expect(q).toContainText("The video's answer: The chromosomes condense.");
  await expect.poll(() => app.evaluate(() => Object.values((window as unknown as W).__mock.db().mistakes).map((m) => m.given))).toEqual(["They split"]);

  await q.getByRole("button", { name: "Keep watching" }).click();
  await expect(panel.getByTestId("watch-status")).toContainText("Question 2 of 2");
  await panel.getByTestId("watch-ask-now").click();
  await q.getByLabel("Your answer").fill("Condense");
  await q.getByRole("button", { name: "Check" }).click();
  await expect(q.getByTestId("watch-feedback")).toHaveAttribute("data-correct", "true");
  await q.getByRole("button", { name: "Finish" }).click();
  await expect(panel.getByTestId("watch-status")).toHaveText("Done. 1 of 2 right.");
});
