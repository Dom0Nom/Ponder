/** bun scripts/design-dump.ts <id> [--port 1560] [--box x,y,w,h]: per-element geometry, design vs app */
import { chromium } from "@playwright/test";
import process from "node:process";
import { buildRecipes } from "./design-diff/recipes";

const id = process.argv[2];
const pi = process.argv.indexOf("--port");
const port = pi > 0 ? Number(process.argv[pi + 1]) : 1560;
const bi = process.argv.indexOf("--box");
const box = bi > 0 ? process.argv[bi + 1].split(",").map(Number) : [0, 0, 1280, 800];
const FILES = { "app-screens": "App%20Screens.dc.html", "space-v2": "Space%20Screen%20v2.dc.html" } as const;

const collect = ({ root, box }: { root: string | null; box: number[] }) => {
  const el = root ? (document.getElementById(root)!.children[1] as HTMLElement) : document.body;
  const o = el.getBoundingClientRect();
  const ox = root ? o.x + (parseFloat(getComputedStyle(el).borderLeftWidth) || 0) : 0;
  const oy = root ? o.y + (parseFloat(getComputedStyle(el).borderTopWidth) || 0) : 0;
  const out: string[] = [];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  for (const e of Array.from(el.querySelectorAll("*")) as HTMLElement[]) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const b = e.getBoundingClientRect();
    const x = b.x - ox;
    const y = b.y - oy;
    if (b.width === 0 || b.height === 0 || x + b.width < box[0] || x > box[0] + box[2] || y + b.height < box[1] || y > box[1] + box[3]) continue;
    const own = Array.from(e.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent!.trim())
      .join(" ")
      .trim();
    const bg = cs.backgroundColor !== "rgba(0, 0, 0, 0)";
    const bd = parseFloat(cs.borderTopWidth) > 0;
    const tag = own
      ? `"${own.slice(0, 40)}" ${cs.fontSize}/${cs.fontWeight}/${cs.lineHeight} ${cs.color}`
      : e.tagName.toLowerCase() === "svg" || e.tagName === "I"
        ? "icon"
        : bg || bd
          ? `box bg=${cs.backgroundColor} bd=${bd ? cs.borderTopColor : "-"} r=${cs.borderTopLeftRadius}`
          : "";
    if (!tag) continue;
    out.push(`${r1(x)},${r1(y)} ${r1(b.width)}x${r1(b.height)}  ${tag}`);
  }
  return out;
};

const main = async () => {
  const r = buildRecipes().find((x) => x.id === id)!;
  const browser = await chromium.launch();
  const dark = id.endsWith("b");
  const dctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", timezoneId: "UTC", locale: "en-US" });
  const dp = await dctx.newPage();
  await dp.goto(`http://127.0.0.1:8765/${FILES[r.source]}`);
  await dp.waitForFunction((i) => !!document.getElementById(i)?.children[1], id);
  await dp.evaluate(() => document.fonts.ready);
  const d = await dp.evaluate(collect, { root: id, box });
  const actx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: dark ? "dark" : "light", timezoneId: "UTC", locale: "en-US" });
  const ap = await actx.newPage();
  await ap.goto(`http://localhost:${port}/?${new URLSearchParams(`fixture=design&${r.query}`)}`);
  await ap.waitForFunction(() => "__ui" in window && !!document.querySelector("#root > *"));
  await ap.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important}` });
  await r.setup(ap);
  await ap.evaluate(() => document.fonts.ready);
  const a = await ap.evaluate(collect, { root: null, box });
  console.log("=== DESIGN\n" + d.join("\n") + "\n=== APP\n" + a.join("\n"));
  await browser.close();
};
main();
