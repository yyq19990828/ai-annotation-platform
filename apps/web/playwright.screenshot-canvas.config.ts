import { defineConfig } from "@playwright/test";
import screenshots from "./playwright.screenshots.config";

// Exercise the actual screenshot browser settings without global setup, API, or seed data.
export default defineConfig({
  testDir: "./e2e/screenshots",
  testMatch: "canvas-rendering.spec.ts",
  workers: 1,
  reporter: "list",
  use: {
    viewport: { width: 1440, height: 810 },
    launchOptions: screenshots.use?.launchOptions,
  },
});
