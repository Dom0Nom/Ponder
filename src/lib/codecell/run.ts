import type { CellLang, CellResult } from "./lang";

export const RUN_TIMEOUT_MS = { js: 5_000, python: 20_000 } as const;
const BOOT_TIMEOUT_MS = 90_000;

export class CellTimeout extends Error {
  constructor(public seconds: number) {
    super(`timeout ${seconds}s`);
  }
}

const pyBase = () => new URL(`${import.meta.env.BASE_URL}pyodide/`, location.href).href;

let py: Worker | null = null;
let pyBooted = false;
let pyQueue: Promise<unknown> = Promise.resolve();

function newWorker(lang: CellLang): Worker {
  return lang === "js"
    ? new Worker(new URL("./jsWorker.ts", import.meta.url), { type: "module" })
    : new Worker(new URL("./pyWorker.ts", import.meta.url), { type: "module" });
}

/** JS runs in a fresh worker per run; Python keeps one worker so later cells see earlier definitions, one run at a time. */
export function runCell(lang: CellLang, code: string): Promise<CellResult> {
  if (lang === "js") return runOnce(lang, code);
  const next = pyQueue.then(() => runOnce(lang, code));
  pyQueue = next.catch(() => undefined);
  return next;
}

function runOnce(lang: CellLang, code: string): Promise<CellResult> {
  const w = lang === "js" ? newWorker("js") : (py ??= newWorker("python"));
  const limit = RUN_TIMEOUT_MS[lang] + (lang === "python" && !pyBooted ? BOOT_TIMEOUT_MS : 0);
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      w.onmessage = w.onerror = null;
      if (lang === "js") w.terminate();
    };
    const kill = () => {
      w.terminate();
      if (lang === "python") {
        py = null;
        pyBooted = false;
      }
    };
    const timer = setTimeout(() => {
      done();
      kill();
      reject(new CellTimeout(Math.round(RUN_TIMEOUT_MS[lang] / 1000)));
    }, limit);
    w.onmessage = (e: MessageEvent<CellResult & { bootMs?: number; bootFailed?: boolean }>) => {
      done();
      if (e.data.bootFailed) kill();
      else if (lang === "python") pyBooted = true;
      resolve(e.data);
    };
    w.onerror = (e) => {
      done();
      kill();
      reject(new Error(e.message || "worker failed"));
    };
    w.postMessage(lang === "js" ? { code } : { code, base: pyBase() });
  });
}

export function resetPython() {
  py?.terminate();
  py = null;
  pyBooted = false;
}
