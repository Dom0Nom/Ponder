/**
 * Runs the offline voice (Kokoro-82M in a Web Worker, as the app does) in headless Chromium and
 * WebKit against the Vite dev server and writes the WAV files; nothing is played.
 *
 *   bun scripts/e2e-kokoro.ts [--out DIR] [--port N]
 *
 * First run downloads ~90 MB from Hugging Face into the browser profile's cache.
 */
import { chromium, webkit, type BrowserType } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(flag("out") ?? "kokoro-out");
const port = Number(flag("port") ?? 1460);
mkdirSync(out, { recursive: true });

const vite = spawn("bunx", ["vite", "--port", String(port), "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((ok) => vite.stdout!.on("data", (b: Buffer) => b.toString().includes("Local") && ok()));

const LINES = [
  ["en", "af_heart", "Photosynthesis turns light energy into chemical energy stored in sugar."],
  ["en", "bm_george", "The derivative of x squared is two x."],
];

for (const [name, type] of [["chromium", chromium], ["webkit", webkit]] as [string, BrowserType][]) {
  const browser = await type.launch(name === "chromium" ? { args: ["--mute-audio"] } : {});
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`[${name}] ${m.text()}`));
  await page.goto(`http://localhost:${port}/`);
  for (const [lang, voice, text] of LINES) {
    const t0 = Date.now();
    try {
      const b64 = await page.evaluate(
        async ([text, voice]) => {
          const m = await import("/src/lib/tts/kokoro.ts");
          const a = await m.kokoroSpeak(text, voice);
          let s = "";
          a.bytes.forEach((x: number) => (s += String.fromCharCode(x)));
          return btoa(s);
        },
        [text, voice],
      );
      const bytes = Buffer.from(b64, "base64");
      const file = join(out, `${name}-${lang}-${voice}.wav`);
      writeFileSync(file, bytes);
      const seconds = (bytes.length - 44) / (24000 * 2);
      console.log(`${name} ${voice}: ${((Date.now() - t0) / 1000).toFixed(1)} s for ${seconds.toFixed(1)} s of audio → ${file}`);
    } catch (e) {
      console.log(`${name} ${voice}: FAILED ${(e as Error).message.split("\n")[0]}`);
    }
  }
  await browser.close();
}
vite.kill();
process.exit(0);
