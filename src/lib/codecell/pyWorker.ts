import { clampOutput } from "./lang";

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(o: { batched: (s: string) => void }): void;
  setStderr(o: { batched: (s: string) => void }): void;
  setStdin(o: { error: boolean }): void;
}

let ready: Promise<Pyodide> | null = null;
let sink: string[] = [];

async function boot(base: string): Promise<Pyodide> {
  const mod = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
  const py: Pyodide = await mod.loadPyodide({ indexURL: base });
  py.setStdout({ batched: (s) => sink.push(s) });
  py.setStderr({ batched: (s) => sink.push(s) });
  py.setStdin({ error: true });
  const g = self as unknown as Record<string, unknown>;
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
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
    const value = await py.runPythonAsync(e.data.code);
    if (value !== undefined && value !== null) sink.push(String(value));
    self.postMessage({ ok: true, output: clampOutput(sink.join("\n")), ms: performance.now() - t1, bootMs: t1 - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const tail = msg.trim().split("\n").filter((l) => !l.startsWith("  File \"/lib/python")).join("\n");
    self.postMessage({ ok: false, output: clampOutput(sink.join("\n")), error: tail, ms: performance.now() - t0 });
  }
};
