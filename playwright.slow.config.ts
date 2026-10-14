import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({ ...base, timeout: 300_000, expect: { timeout: 90_000 } });
