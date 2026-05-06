import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 配置。
 *
 * 本地运行前置条件：
 *   1. docker compose up -d   （postgres / redis / minio）
 *   2. cd apps/api && uv run alembic upgrade head
 *   3. cd apps/api && uv run uvicorn app.main:app --port 8000   （另开窗口）
 *   4. cd apps/web && pnpm dev                                  （另开窗口）
 *
 * 然后：pnpm test:e2e
 *
 * CI 中通过 webServer 启动 vite preview，使用真实后端 API。
 */
export default defineConfig({
  testDir: "./e2e",
  // v0.8.5 · seed/reset 是数据库 TRUNCATE 全局操作，多 spec 并发会互相覆盖（auth /
  // annotation / batch-flow 三 spec 共用同一个 fixture），本地与 CI 都用单 worker。
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // 起步只跑 chromium；稳定后再加 firefox/webkit
  ],

  webServer: process.env.CI
    ? {
        command: "pnpm preview --port 3000",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
