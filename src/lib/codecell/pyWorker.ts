import { clampOutput } from "./lang";

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  loadPackagesFromImports(code: string, opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<void>;
  setStdout(o: { batched: (s: string) => void }): void;
  setStderr(o: { batched: (s: string) => void }): void;
  setStdin(o: { error: boolean }): void;
}

let ready: Promise<Pyodide> | null = null;
let sink: string[] = [];
let loadingPackages = false;
let realFetch: typeof fetch | undefined;

const FIGURES = `
import sys, io, base64, json
_figs = []
if "matplotlib.pyplot" in sys.modules:
    import matplotlib.pyplot as _plt
    for _n in _plt.get_fignums():
        _b = io.BytesIO()
        _plt.figure(_n).savefig(_b, format="png", dpi=110, bbox_inches="tight")
        _figs.append(base64.b64encode(_b.getvalue()).decode())
    _plt.close("all")
json.dumps(_figs)
`;

async function boot(base: string): Promise<Pyodide> {
  const mod = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
  const py: Pyodide = await mod.loadPyodide({ indexURL: base });
  py.setStdout({ batched: (s) => sink.push(s) });
  py.setStderr({ batched: (s) => sink.push(s) });
  py.setStdin({ error: true });
  py.runPython('import os; os.environ["MPLBACKEND"] = "AGG"');
  const g = self as unknown as Record<string, unknown>;
  realFetch = self.fetch.bind(self);
  const guarded = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return loadingPackages && url.startsWith(base) ? realFetch!(input, init) : Promise.reject(new TypeError("Network access is disabled in code cells"));
  };
  Object.defineProperty(g, "fetch", { value: guarded, configurable: false, writable: false });
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
    try {
      Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false });
    } catch {
      /* already locked */
    }
  }
  return py;
}

self.onmessage = async (e: MessageEvent<{ code: string; base: string }>) => {
  sink = [];
  const t0 = performance.now();
  try {
    ready ??= boot(e.data.base);
    let py: Pyodide;
    try {
      py = await ready;
    } catch (err) {
      ready = null;
      const msg = err instanceof Error ? err.message : String(err);
      self.postMessage({ ok: false, output: "", error: msg, ms: performance.now() - t0, bootFailed: true });
      return;
    }
    const t1 = performance.now();
    loadingPackages = true;
    try {
      await py.loadPackagesFromImports(e.data.code, { messageCallback: () => {}, errorCallback: () => {} });
    } finally {
      loadingPackages = false;
    }
    const value = await py.runPythonAsync(e.data.code);
    if (value !== undefined && value !== null) sink.push(String(value));
    const images = JSON.parse(String(py.runPython(FIGURES))) as string[];
    self.postMessage({ ok: true, output: clampOutput(sink.join("\n")), images, ms: performance.now() - t1, bootMs: t1 - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const tail = msg.trim().split("\n").filter((l) => !l.startsWith("  File \"/lib/python")).join("\n");
    self.postMessage({ ok: false, output: clampOutput(sink.join("\n")), error: tail, ms: performance.now() - t0 });
    try {
      if (ready) (await ready).runPython('import sys\nif "matplotlib.pyplot" in sys.modules:\n    sys.modules["matplotlib.pyplot"].close("all")');
    } catch {
      /* worker is going away */
    }
  }
};
