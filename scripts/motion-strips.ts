/**
 * 10-frame strips of the main motion snippets, light and dark, saved to design/compare/motion/<name>-<theme>.png.
 * Needs the Vite app running: `bun run dev -- --port 1478`, then `bun scripts/motion-strips.ts --port 1478`.
 * Frames are exact: every running CSS animation/transition is paused and seeked to the frame time.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "1478";
const base = `http://localhost:${port}`;
const FRAMES = [0, 40, 80, 120, 160, 240, 320, 480, 640, 800];
const out = "design/compare/motion";
mkdirSync(out, { recursive: true });

type Clip = { x: number; y: number; width: number; height: number };

async function seek(page: Page, t: number) {
  await page.evaluate((ms) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = ms;
    }
  }, t);
}

async function strip(page: Page, name: string, theme: string, clip: Clip, frames: Buffer[]) {
  const html = `<body style="margin:0;background:${theme === "dark" ? "#111" : "#fff"};display:flex;gap:4px">${frames
    .map((f) => `<img src="data:image/png;base64,${f.toString("base64")}" width="${clip.width}">`)
    .join("")}</body>`;
  const p = await page.context().newPage();
  await p.setViewportSize({ width: (clip.width + 4) * frames.length, height: clip.height });
  await p.setContent(html);
  const buf = await p.screenshot();
  writeFileSync(`${out}/${name}-${theme}.png`, buf);
  await p.close();
}

async function capture(page: Page, name: string, theme: string, clip: Clip, trigger: () => Promise<void>) {
  await trigger();
  const frames: Buffer[] = [];
  for (const t of FRAMES) {
    await seek(page, t);
    await page.waitForTimeout(30);
    frames.push(await page.screenshot({ clip }));
  }
  await strip(page, name, theme, clip, frames);
}

const browser = await chromium.launch({ args: ["--mute-audio"] });
for (const theme of ["light", "dark"] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: theme, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.evaluate(() => localStorage.clear());

  await page.goto(`${base}/?fixture=design&seed`);
  await page.waitForTimeout(1500);
  await capture(page, "home-stagger", theme, { x: 260, y: 120, width: 760, height: 420 }, async () => {
    await page.reload();
    await page.waitForSelector('[data-testid="space-grid"]');
  });

  await page.goto(`${base}/?seed`);
  await page.waitForTimeout(800);
  await capture(page, "modal-open", theme, { x: 380, y: 140, width: 600, height: 520 }, async () => {
    await page.getByRole("button", { name: "New space" }).first().click();
    await page.getByRole("dialog").waitFor();
  });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(800);
  const sw = page.getByRole("switch", { name: "Reduce motion" });
  const box = await sw.boundingBox();
  if (box) {
    await capture(page, "toggle", theme, { x: Math.max(0, box.x - 120), y: box.y - 14, width: 220, height: 48 }, async () => {
      await page.getByRole("switch", { name: "Visual effects" }).click();
    });
  }

  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="strip-demo" style="position:fixed;left:40px;top:40px;width:420px;height:200px;background:var(--surface);border:1px solid var(--border);border-radius:10px;z-index:9999;padding:24px;display:flex;flex-direction:column;gap:12px;font-size:40px">
        <span class="t-reel" style="--reel-cell:48px;line-height:48px"><span class="t-reel-d"><span class="t-reel-col" style="--n:1;--k:0"><span style="height:48px">0</span><span style="height:48px">1</span></span></span><span class="t-reel-d"><span class="t-reel-col" style="--n:7;--k:1">${[0, 1, 2, 3, 4, 5, 6, 7].map((d) => `<span style="height:48px">${d}</span>`).join("")}</span></span><span class="t-reel-d"><span class="t-reel-col" style="--n:8;--k:2">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((d) => `<span style="height:48px">${d}</span>`).join("")}</span></span></span>
        <span class="t-shimmer" style="font-size:16px">Searching your sources</span></div>`,
    );
  });
  await capture(page, "spinning-counter-shimmer", theme, { x: 40, y: 40, width: 420, height: 140 }, async () => {
    await page.evaluate(() => {
      const el = document.getElementById("strip-demo")!;
      el.replaceWith(el.cloneNode(true));
    });
  });
  await ctx.close();
}
await browser.close();
console.log(`wrote strips to ${out}`);
