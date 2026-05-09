/**
 * v2 · 截图自动化多 project 配置。
 *
 * 执行：
 *   pnpm screenshots                  # desktop-light 全量（默认）
 *   pnpm screenshots:dark             # desktop-dark 单跑
 *   pnpm screenshots:matrix           # 四个截图 project 全跑
 *   pnpm screenshots:flows            # 流程录制 → GIF（video:on）
 *   pnpm screenshots:regression       # 视觉回归子集（M4）
 *
 * 调试：
 *   PWDEBUG=1 pnpm screenshots -- --project=desktop-light --grep="bbox/toolbar"
 *
 * 不进 CI 默认；CI 只跑 regression 子集（见 M4 / .github/workflows）。
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e/screenshots",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: "list",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: { mode: "retain-on-failure", size: { width: 1280, height: 720 } },
    screenshot: "only-on-failure",
  },

  projects: [
    // ── 截图矩阵 ────────────────────────────────────────────────
    {
      name: "desktop-light",
      testMatch: ["**/screenshots.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      },
    },
    {
      name: "desktop-dark",
      testMatch: ["**/screenshots.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        colorScheme: "dark",
      },
    },
    {
      name: "tablet",
      testMatch: ["**/screenshots.spec.ts"],
      use: { ...devices["iPad Pro 11"] },
    },
    {
      name: "mobile",
      testMatch: ["**/screenshots.spec.ts"],
      use: { ...devices["iPhone 14"] },
    },
    // ── 流程录制（video:on 全程）────────────────────────────────
    {
      name: "flows",
      testMatch: ["**/flows/flows.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        video: { mode: "on", size: { width: 1280, height: 720 } },
        trace: "on",
      },
    },
    // ── 视觉回归（M4，固定 seed-fixed）─────────────────────────
    {
      name: "regression",
      testMatch: ["**/regression/regression.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      },
    },
  ],
});
