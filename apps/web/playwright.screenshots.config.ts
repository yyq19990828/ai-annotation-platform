/**
 * v0.8.7 F4 · 截图自动化独立配置（与默认 playwright.config.ts 分开）。
 *
 * 通过 `pnpm screenshots` 触发，testDir 直接指向 e2e/screenshots，
 * 避免主配置的 testMatch 把 screenshots 屏蔽。
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/screenshots",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
