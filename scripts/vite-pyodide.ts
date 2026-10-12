import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
const TYPES: Record<string, string> = { mjs: "text/javascript", js: "text/javascript", wasm: "application/wasm", zip: "application/zip", json: "application/json" };

/** Serves and bundles the Pyodide core under /pyodide/ so Python code cells run offline. */
export function pyodide(): Plugin {
  const dir = join(process.cwd(), "node_modules", "pyodide");
  return {
    name: "ponder-pyodide",
    configureServer(server) {
      server.middlewares.use("/pyodide/", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (!FILES.includes(name) || !existsSync(join(dir, name))) return next();
        res.setHeader("Content-Type", TYPES[name.split(".").pop()!] ?? "application/octet-stream");
        createReadStream(join(dir, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of FILES) this.emitFile({ type: "asset", fileName: `pyodide/${name}`, source: readFileSync(join(dir, name)) });
    },
  };
}
