import { api } from "../ipc";
import type { CRun } from "../types";
import type { CellResult } from "./lang";

export const C_INSTALL_HINT = {
  mac: "xcode-select --install",
  linux: "sudo apt install build-essential",
  windows: "MSYS2 (pacman -S mingw-w64-ucrt-x86_64-gcc)",
} as const;

/** Compiles and runs a C program with the system compiler; stdin is fed to the program. */
export function runC(code: string, stdin = ""): Promise<CRun> {
  return api.runC(code, stdin);
}

export function cellResultFromC(r: CRun): CellResult {
  const ms = r.compileMs + r.runMs;
  if (r.stage === "none") return { ok: false, output: "", error: "No C compiler found", ms };
  if (r.timedOut) return { ok: false, output: r.output, error: r.stage === "compile" ? "Compiler timed out" : "Stopped after 5 seconds", ms };
  return { ok: r.ok, output: r.stage === "run" ? r.output : "", error: r.stage === "compile" ? r.output : r.ok ? undefined : `Exit code ${r.exitCode ?? "?"}`, ms };
}

/** Passing means it compiled, exited 0 and (when given) printed the expected text. */
export function checkC(r: CRun, expected?: string): boolean {
  return r.stage === "run" && r.ok && (expected === undefined || r.output.trim() === expected.trim());
}
