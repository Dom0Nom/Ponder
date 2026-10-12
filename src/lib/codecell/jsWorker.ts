import { clampOutput, formatValue } from "./lang";

const g = self as unknown as Record<string, unknown>;
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts", "indexedDB", "caches", "BroadcastChannel", "WebTransport"]) {
  for (let o: object | null = self; o; o = Object.getPrototypeOf(o)) {
    try {
      delete (o as Record<string, unknown>)[name];
    } catch {
      /* non-configurable */
    }
  }
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* already locked */
  }
}

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const lines: string[] = [];
  const log = (...a: unknown[]) => lines.push(a.map(formatValue).join(" "));
  g.console = { log, info: log, warn: log, error: log, debug: log, table: log, dir: log };
  const t0 = performance.now();
  try {
    const fn = new Function(`"use strict"; return (async () => {\n${e.data.code}\n})();`);
    await fn();
    self.postMessage({ ok: true, output: clampOutput(lines.join("\n")), ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ ok: false, output: clampOutput(lines.join("\n")), error: formatValue(err), ms: performance.now() - t0 });
  }
};
