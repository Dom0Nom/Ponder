/** bun scripts/design-probe.ts <id> "<text>" [--port 1560]: ancestor chain (tag.classes, margin/gap) of the app element with this text */
import { chromium } from "@playwright/test";
import process from "node:process";
import { buildRecipes } from "./design-diff/recipes";

const id = process.argv[2];
const text = process.argv[3];
const pi = process.argv.indexOf("--port");
const port = pi > 0 ? Number(process.argv[pi + 1]) : 1560;

const browser = await chromium.launch();
const r = buildRecipes().find((x) => x.id === id)!;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: id.endsWith("b") ? "dark" : "light", timezoneId: "UTC", locale: "en-US" });
const p = await ctx.newPage();
await p.goto(`http://localhost:${port}/?${new URLSearchParams(`fixture=design&${r.query}`)}`);
await p.waitForFunction(() => "__ui" in window && !!document.querySelector("#root > *"));
await p.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important}` });
await r.setup(p);
const out = await p.evaluate((t) => {
  const el = Array.from(document.querySelectorAll("*")).filter((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").includes(t))).pop() as HTMLElement | undefined;
  const lines: string[] = [];
  for (let e: HTMLElement | null = el ?? null; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    const b = e.getBoundingClientRect();
    lines.push(`${e.tagName.toLowerCase()}[${e.getAttribute("data-testid") ?? ""}].${e.className.toString().slice(0, 110)} | ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} gap=${cs.rowGap} mt=${cs.marginTop} mb=${cs.marginBottom} pad=${cs.padding}`);
  }
  return lines;
}, text);
console.log(out.join("\n"));
await browser.close();
