/**
 * v2 · 截图自动化多 project 配置。
 *
 * 执行：
 *   pnpm screenshots                  # desktop-light 全量（默认）
 *   pnpm screenshots:dark             # desktop-dark 单跑
 *   pnpm screenshots:matrix           # 三个截图 project 全跑
 *   pnpm screenshots:flows            # 流程录制 → GIF（video:on）
 *   pnpm screenshots:regression       # 视觉回归子集（M4）
 *
 * 调试：
 *   PWDEBUG=1 pnpm screenshots --grep="bbox/toolbar"
 *
 * 不进 CI 默认；CI 只跑 regression 子集（见 M4 / .github/workflows）。
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3001";
const VALIDATE_ONLY = process.env.SCREENSHOT_VALIDATE_ONLY === "1";

export default defineConfig({
  testDir: "./e2e/screenshots",
  testMatch: ["**/*.spec.ts"],
  globalSetup: "./e2e/screenshots/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["./e2e/screenshots/manifest-reporter.ts"],
  ],
  snapshotPathTemplate: "{testDir}/regression/__screenshots__/{arg}{ext}",

  use: {
    baseURL: BASE_URL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
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
        deviceScaleFactor: 1,
        colorScheme: "light",
      },
    },
    {
      name: "desktop-dark",
      testMatch: ["**/screenshots.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: "dark",
      },
    },
    {
      name: "mobile",
      testMatch: ["**/screenshots.spec.ts"],
      use: {
        ...devices["iPhone 14"],
        browserName: "chromium",
        deviceScaleFactor: 1,
      },
    },
    // ── 流程录制（video:on 全程）────────────────────────────────
    {
      name: "flows",
      testMatch: ["**/flows/flows.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 810 },
        deviceScaleFactor: 1,
        video: VALIDATE_ONLY
          ? "off"
          : { mode: "on", size: { width: 1440, height: 810 } },
        trace: "on",
      },
    },
    // ── 视觉回归（同一 screenshot catalog + protocol stub）─────────────
    {
      name: "regression",
      testMatch: ["**/regression/regression.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: "light",
      },
    },
  ],
});
