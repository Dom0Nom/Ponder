import { defineConfig, devices } from "@playwright/test";
import process from "node:process";

/** E2E_PORT runs a separate Vite server, e.g. when another one already uses 1420. */
const port = Number(process.env.E2E_PORT ?? 1420);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    viewport: { width: 1360, height: 860 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 } } }],
  webServer: {
    command: port === 1420 ? "bun run dev" : `bunx vite --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
