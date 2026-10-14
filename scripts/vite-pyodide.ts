import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
const TYPES: Record<string, string> = { mjs: "text/javascript", js: "text/javascript", wasm: "application/wasm", zip: "application/zip", json: "application/json", whl: "application/zip" };

/** Packages Python cells can import offline; their dependencies come from pyodide-lock.json. */
export const PACKAGES = ["numpy", "matplotlib", "sympy"];

type Lock = { packages: Record<string, { file_name: string; depends: string[] }> };

/** File names of the wheels needed by PACKAGES, dependencies included. */
export function wheelFiles(lock: Lock, roots: string[] = PACKAGES): string[] {
  const seen = new Set<string>();
  const visit = (name: string) => {
    const p = lock.packages[name.toLowerCase()];
    if (!p || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    p.depends.forEach(visit);
  };
  roots.forEach(visit);
  return [...seen].map((n) => lock.packages[n].file_name).sort();
}

/**
 * Serves and bundles the Pyodide core under /pyodide/ so Python code cells run offline. The numpy, matplotlib and
 * sympy wheels are not in the npm package: they are downloaded once for the pinned version into
 * node_modules/.cache/ponder-pyodide and bundled next to the core.
 */
export function pyodide(): Plugin {
  const dir = join(process.cwd(), "node_modules", "pyodide");
  const cache = join(process.cwd(), "node_modules", ".cache", "ponder-pyodide");
  let wheels: string[] = [];
  const locate = (name: string) => (FILES.includes(name) ? join(dir, name) : wheels.includes(name) ? join(cache, name) : null);

  async function fetchWheels(): Promise<string[]> {
    const lockPath = join(dir, "pyodide-lock.json");
    if (!existsSync(lockPath)) return [];
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version as string;
    const names = wheelFiles(JSON.parse(readFileSync(lockPath, "utf8")) as Lock);
    mkdirSync(cache, { recursive: true });
    for (const name of names) {
      const file = join(cache, name);
      if (existsSync(file)) continue;
      const res = await fetch(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${name}`);
      if (!res.ok) throw new Error(`pyodide: could not download ${name} (${res.status})`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    return names;
  }

  return {
    name: "ponder-pyodide",
    async buildStart() {
      try {
        wheels = await fetchWheels();
      } catch (e) {
        if (this.meta.watchMode) this.warn(String(e));
        else this.error(String(e));
      }
    },
    configureServer(server) {
      server.middlewares.use("/pyodide/", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
        const file = locate(name);
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", TYPES[name.split(".").pop()!] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of [...FILES, ...wheels]) {
        const file = locate(name)!;
        if (!existsSync(file)) this.error(`pyodide: missing ${name}`);
        this.emitFile({ type: "asset", fileName: `pyodide/${name}`, source: readFileSync(file) });
      }
    },
  };
}
