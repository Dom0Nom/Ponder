/**
 * 1:1 pixel-diff gate between the design artboards and the running app.
 *
 *   bun scripts/design-diff.ts [ids...] [--native] [--webkit] [--port 1450] [--json] [--refresh-design] [--all]
 *
 * --webkit: render the app side in Playwright WebKit (same engine family as the macOS WKWebView).
 *
 * ids: "12", "12a", "12b" (a number means light and dark); no ids means every screen.
 * Design side: screenshots each artboard's 1280x800 frame at 2x, cached in design/compare/design/ (served from
 *   design/ on port 8765, started here if it isn't running).
 * App side: the Vite app on --port (started here if it isn't running) with ?fixture=design, a fresh page per screen,
 *   frozen clock, animations off, recipe from scripts/design-diff/recipes.ts.
 * Output: design/compare/<id>-app.png, <id>-diff.png (gitignored), a table, and with --json design/compare/report.json.
 * Exit code is 1 when a non-pending screen differs by more than 0.5% (or fails to render).
 *
 * --native: compare against the real Tauri window instead of Vite, for screens 1, 2, 3, 12, 15, 23, 24, 38.
 *   Limits: this script never drives the native UI. Start the app on the design fixture yourself:
 *     VITE_MOCK_IPC=1 VITE_FIXTURE=design bun run tauri dev
 *   (the fixture is then seeded in the webview's mock backend; the frozen clock applies). Size the window to
 *   1280x800 points (the capture is resized to 2560x1600 only when the aspect ratio already matches), put it in
 *   the state of each screen (see `query` options in src/test/designFixture.ts and each recipe), and the script
 *   asks you to confirm per screen before capturing it with `screencapture -l <windowId> -o`. Theme follows the
 *   macOS appearance, so run the light screens first, then switch appearance for the dark ones.
 *   Window owner is matched by NATIVE_OWNER (default "ai-learning-app|Ponder|AI Learning App").
 */
import { chromium, webkit, type Browser, type Page } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { buildRecipes, type Mask, type Recipe, type Region } from "./design-diff/recipes";

const ROOT = resolve(import.meta.dir, "..");
const DESIGN_DIR = join(ROOT, "design");
const OUT = join(DESIGN_DIR, "compare");
const DESIGN_OUT = join(OUT, "design");
const DESIGN_PORT = 8765;
const THRESHOLD_PCT = 0.5;
const W = 1280;
const H = 800;
const SCALE = 2;
const FILES: Record<Recipe["source"], string> = {
  "app-screens": "App%20Screens.dc.html",
  "space-v2": "Space%20Screen%20v2.dc.html",
};

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const optValues = new Set(["--port"]);
const idArgs = args.filter((a, i) => !a.startsWith("--") && !optValues.has(args[i - 1] ?? ""));
const PORT = Number(opt("--port", "1450"));
const NATIVE = flag("--native");

const CSS_FREEZE = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

async function reachable(url: string) {
  try {
    const r = await fetch(url);
    return r.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(url: string, ms = 60_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await reachable(url)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const children: ChildProcess[] = [];
async function ensureServers(needApp: boolean) {
  if (!(await reachable(`http://127.0.0.1:${DESIGN_PORT}/`))) {
    children.push(spawn("python3", ["-m", "http.server", String(DESIGN_PORT), "--bind", "127.0.0.1"], { cwd: DESIGN_DIR, stdio: "ignore" }));
    await waitFor(`http://127.0.0.1:${DESIGN_PORT}/`, 10_000);
  }
  if (needApp && !(await reachable(`http://localhost:${PORT}/`))) {
    children.push(spawn("bunx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" }));
    await waitFor(`http://localhost:${PORT}/`);
  }
}

function newerThanDesign(file: string) {
  if (!existsSync(file)) return false;
  const m = statSync(file).mtimeMs;
  return ["App Screens.dc.html", "Space Screen v2.dc.html", "support.js"].every((f) => statSync(join(DESIGN_DIR, f)).mtimeMs <= m);
}

// Corrections to the design artboards themselves, confirmed by the user.
const DESIGN_FIXES: Record<string, { reason: string; arg: string; run: (root: Element, text: string) => void }> = {
  // 31b kept a subtitle that was removed from 31a; the user confirmed the dark artboard is the mistake (2026-10-07).
  "31b": {
    reason: "remove the leftover subtitle from the dark mistake notebook artboard",
    arg: "Due cards from all your spaces.",
    run: (root, text) => {
      const hit = [...root.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent?.trim() === text);
      hit?.remove();
    },
  },
};

async function shootDesign(browser: Browser, recipes: Recipe[], refresh: boolean) {
  mkdirSync(DESIGN_OUT, { recursive: true });
  const todo = recipes.filter((r) => refresh || !newerThanDesign(join(DESIGN_OUT, `${r.id}.png`)));
  const failures: Record<string, string> = {};
  for (const source of ["app-screens", "space-v2"] as const) {
    const rs = todo.filter((r) => r.source === source);
    if (!rs.length) continue;
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: SCALE, reducedMotion: "reduce", timezoneId: "UTC", locale: "en-US" });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${DESIGN_PORT}/${FILES[source]}`);
    await page.addStyleTag({ content: CSS_FREEZE });
    await page.waitForFunction((id) => !!document.getElementById(id)?.children[1], rs[0].id, { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    for (const r of rs) {
      try {
        const handle = await page.evaluateHandle((id) => document.getElementById(id)?.children[1] ?? null, r.id);
        const el = handle.asElement();
        if (!el) throw new Error(`artboard ${r.id} not found in ${FILES[source]}`);
        await el.scrollIntoViewIfNeeded();
        const fix = DESIGN_FIXES[r.id];
        if (fix) await el.evaluate(fix.run, fix.arg);
        await page.evaluate(() => document.fonts.ready);
        const clip = await el.evaluate((e) => {
          const b = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return { x: b.x + parseFloat(cs.borderLeftWidth), y: b.y + parseFloat(cs.borderTopWidth), width: 1280, height: 800 };
        });
        await page.screenshot({ path: join(DESIGN_OUT, `${r.id}.png`), clip });
      } catch (e) {
        failures[r.id] = String(e);
      }
    }
    await ctx.close();
  }
  return failures;
}

async function shootApp(browser: Browser, r: Recipe): Promise<Buffer> {
  const dark = r.id.endsWith("b");
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
    reducedMotion: "reduce",
    colorScheme: dark ? "dark" : "light",
    timezoneId: "UTC",
    locale: "en-US",
  });
  const page: Page = await ctx.newPage();
  page.setDefaultTimeout(2500);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    const q = new URLSearchParams(`fixture=design&${r.query}`);
    await page.goto(`http://localhost:${PORT}/?${q}`, { timeout: 30_000 });
    await page.waitForFunction(() => "__ui" in window && !!document.querySelector("#root > *"), null, { timeout: 15_000 });
    await page.addStyleTag({ content: CSS_FREEZE });
    await r.setup(page);
    await page.addStyleTag({ content: CSS_FREEZE });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    return await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  } catch (e) {
    throw new Error(`${String(e).split("\n")[0]}${errors.length ? ` (page error: ${errors[0]})` : ""}`);
  } finally {
    await ctx.close();
  }
}

function applyMasks(png: PNG, masks: Mask[]) {
  for (const m of masks) {
    const x0 = Math.max(0, Math.round(m.x * SCALE));
    const y0 = Math.max(0, Math.round(m.y * SCALE));
    const x1 = Math.min(png.width, Math.round((m.x + m.w) * SCALE));
    const y1 = Math.min(png.height, Math.round((m.y + m.h) * SCALE));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (png.width * y + x) * 4;
        png.data[i] = 255;
        png.data[i + 1] = 0;
        png.data[i + 2] = 255;
        png.data[i + 3] = 255;
      }
  }
}

// Deliberate deviations the user asked for after the design was drawn; excluded from every full-frame compare.
const USER_DEVIATIONS: (Mask & { screens?: number[] })[] = [
  { x: 104, y: 10, w: 100, h: 28, reason: "Ponder mark + wordmark in the sidebar top row, requested by the user 2026-10-07" },
  { x: 380, y: 732, w: 270, h: 36, screens: [2, 38], reason: "model logo in the composer button, requested by the user 2026-10-07" },
  { x: 320, y: 56, w: 98, h: 34, screens: [27], reason: "prominent deep research entry in the sources panel header, requested by the user 2026-10-07" },
  { x: 686, y: 457, w: 132, h: 39, screens: [38], reason: "prominent deep research entry in the empty space state, requested by the user 2026-10-07" },
];
const deviationsFor = (n: number) => USER_DEVIATIONS.filter((m) => !m.screens || m.screens.includes(n));

// Header back button on Practice and Review (it shifts the breadcrumb), requested by the user 2026-10-07.
const BACK_BUTTON_SCREENS = new Set([3, 4, 12, 31, 37]);
const BACK_BUTTON: Mask = { x: 268, y: 8, w: 460, h: 32, reason: "header back button + shifted breadcrumb on Practice/Review, requested by the user 2026-10-07" };

function crop(png: PNG, r: Region): PNG {
  const x0 = Math.round(r.x * SCALE), y0 = Math.round(r.y * SCALE);
  const out = new PNG({ width: Math.round(r.w * SCALE), height: Math.round(r.h * SCALE) });
  PNG.bitblt(png, out, x0, y0, out.width, out.height, 0, 0);
  return out;
}

function compare(designPath: string, appBuf: Buffer, masks: Mask[], diffPath: string, region: Region | undefined, screen: number) {
  let a = PNG.sync.read(readFileSync(designPath));
  let b = PNG.sync.read(appBuf);
  if (region) {
    a = crop(a, region);
    b = crop(b, region);
    masks = [...masks, ...deviationsFor(screen).map((m) => ({ ...m, x: m.x - region.x, y: m.y - region.y }))];
  } else {
    masks = [...masks, ...deviationsFor(screen)];
  }
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: design ${a.width}x${a.height}, app ${b.width}x${b.height}`);
  }
  applyMasks(a, masks);
  applyMasks(b, masks);
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  writeFileSync(diffPath, PNG.sync.write(diff));
  return (n / (a.width * a.height)) * 100;
}

// ---------- native ----------

const SWIFT_WINDOWS = `
import Cocoa
let owners = CommandLine.arguments[1]
let re = try! NSRegularExpression(pattern: owners, options: [.caseInsensitive])
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
  let layer = (w[kCGWindowLayer as String] as? Int) ?? 0
  let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
  if layer == 0, re.firstMatch(in: owner, range: NSRange(owner.startIndex..., in: owner)) != nil, (b["Width"] ?? 0) > 600 {
    print(w[kCGWindowNumber as String] as! Int, Int(b["Width"] ?? 0), Int(b["Height"] ?? 0))
    break
  }
}
`;

function nativeWindow(): { id: number; w: number; h: number } {
  const dir = join(OUT, ".tmp");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "windows.swift");
  writeFileSync(file, SWIFT_WINDOWS);
  const r = spawnSync("swift", [file, process.env.NATIVE_OWNER ?? "ai-learning-app|Ponder|AI Learning App"], { encoding: "utf8" });
  const [id, w, h] = (r.stdout.trim().split(/\s+/) ?? []).map(Number);
  if (!id) throw new Error(`No native app window found (set NATIVE_OWNER to its process name). ${r.stderr.slice(0, 200)}`);
  return { id, w, h };
}

function captureNative(outPath: string) {
  const win = nativeWindow();
  const raw = `${outPath}.raw.png`;
  const r = spawnSync("screencapture", ["-l", String(win.id), "-o", "-x", raw]);
  if (r.status !== 0) throw new Error("screencapture failed (grant Screen Recording permission to the terminal)");
  const png = PNG.sync.read(readFileSync(raw));
  const aspect = png.width / png.height;
  if (Math.abs(aspect - W / H) / (W / H) > 0.01) {
    throw new Error(`window is ${win.w}x${win.h} pt; resize it to 1280x800 pt (aspect ${aspect.toFixed(3)} vs 1.6)`);
  }
  if (png.width !== W * SCALE) spawnSync("sips", ["-z", String(H * SCALE), String(W * SCALE), raw, "--out", outPath], { stdio: "ignore" });
  else writeFileSync(outPath, readFileSync(raw));
  return readFileSync(outPath);
}

// ---------- main ----------

interface Row {
  id: string;
  title: string;
  pct: number | null;
  status: "pass" | "fail" | "pending" | "error";
  note?: string;
  masks: number;
}

async function main() {
  const all = buildRecipes();
  let recipes = all;
  if (idArgs.length) {
    const wanted = new Set(idArgs.flatMap((x) => (/[ab]$/.test(x) ? [x] : [`${x}a`, `${x}b`])));
    recipes = all.filter((r) => wanted.has(r.id));
    const missing = [...wanted].filter((id) => !recipes.some((r) => r.id === id));
    if (missing.length) throw new Error(`Unknown ids: ${missing.join(", ")}`);
  }
  if (NATIVE) {
    recipes = (idArgs.length ? recipes : all).filter((r) => r.native);
    if (!recipes.length) throw new Error("None of these screens support --native");
  }
  mkdirSync(OUT, { recursive: true });
  await ensureServers(!NATIVE);

  const browser = await chromium.launch();
  // --webkit renders the app in WebKit (the engine behind the macOS app's WKWebView); the design side stays Chromium
  const appBrowser = flag("--webkit") ? await webkit.launch() : browser;
  const rows: Row[] = [];
  try {
    const designFail = await shootDesign(browser, recipes, flag("--refresh-design"));
    const rl = NATIVE ? createInterface({ input: process.stdin, output: process.stdout }) : null;
    for (const r of recipes) {
      const row: Row = { id: r.id, title: r.title, pct: null, status: "error", masks: r.masks.length };
      rows.push(row);
      if (designFail[r.id]) {
        row.note = `design: ${designFail[r.id]}`;
        continue;
      }
      try {
        const appPath = join(OUT, `${r.id}-app.png`);
        let buf: Buffer;
        if (rl) {
          await rl.question(`\nShow screen ${r.id} (${r.title}${r.query ? `, fixture options: ${r.query}` : ""}) in the native window, then press Enter... `);
          buf = captureNative(appPath);
        } else {
          buf = await shootApp(appBrowser, r);
        }
        writeFileSync(appPath, buf);
        row.pct = compare(join(DESIGN_OUT, `${r.id}.png`), buf, BACK_BUTTON_SCREENS.has(r.n) ? [...r.masks, BACK_BUTTON] : r.masks, join(OUT, `${r.id}-diff.png`), r.region, r.n);
        row.status = row.pct <= THRESHOLD_PCT ? "pass" : r.pending ? "pending" : "fail";
        if (r.pending) row.note = r.pending;
      } catch (e) {
        row.note = String(e instanceof Error ? e.message : e);
        row.status = r.pending ? "pending" : "error";
      }
    }
    rl?.close();
  } finally {
    if (appBrowser !== browser) await appBrowser.close();
    await browser.close();
    for (const c of children) c.kill();
  }

  const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
  console.log(`\n${pad("id", 5)}${pad("diff %", 9)}${pad("result", 9)}${pad("masks", 7)}title`);
  for (const r of rows) {
    const res = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : r.status === "pending" ? "pending" : "ERROR";
    console.log(`${pad(r.id, 5)}${pad(r.pct === null ? "-" : r.pct.toFixed(2), 9)}${pad(res, 9)}${pad(String(r.masks), 7)}${r.title}${r.status === "error" ? `  [${r.note}]` : ""}`);
  }
  const bad = rows.filter((r) => r.status === "fail" || r.status === "error");
  console.log(`\n${rows.filter((r) => r.status === "pass").length} pass, ${bad.length} fail/error, ${rows.filter((r) => r.status === "pending").length} pending (threshold ${THRESHOLD_PCT}%)`);
  if (flag("--json")) {
    writeFileSync(join(OUT, "report.json"), JSON.stringify({ threshold: THRESHOLD_PCT, native: NATIVE, rows }, null, 2));
    console.log(`wrote ${join(OUT, "report.json")}`);
  }
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  for (const c of children) c.kill();
  process.exit(2);
});
