import { defineConfig, devices } from "@playwright/test";
import process from "node:process";

// E2E_PORT lets parallel checkouts run e2e without fighting over 1420
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
    command: `bun run dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
