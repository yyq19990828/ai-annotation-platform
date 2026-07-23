import { defineConfig, devices } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rasterMaskMatrix = process.env.PLAYWRIGHT_RASTER_MASK_MATRIX;
const rasterMaskCreateEnabled = rasterMaskMatrix === "native";
const configDir = dirname(fileURLToPath(import.meta.url));
const isCI = Boolean(process.env.CI);
const useIsolatedServers = !isCI || Boolean(rasterMaskMatrix);

if (useIsolatedServers) {
  // 固定隔离端口，避免继承 shell/CI job 中指向开发服务的旧变量。
  process.env.PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3001";
  process.env.PLAYWRIGHT_API_BASE = "http://127.0.0.1:8010";
}

const defaultBaseURL = useIsolatedServers ? "http://127.0.0.1:3001" : "http://127.0.0.1:3000";
const e2eDatabaseURL = isCI
  ? (process.env.DATABASE_URL ?? "postgresql+asyncpg://user:pass@127.0.0.1:5432/annotation_test")
  : (process.env.PLAYWRIGHT_E2E_DATABASE_URL ??
    "postgresql+asyncpg://user:pass@127.0.0.1:5432/annotation_e2e");

const isolatedApiCommand = [
  ...(isCI ? [] : ["uv run python scripts/prepare_e2e_db.py"]),
  "uv run alembic upgrade head",
  "uv run uvicorn app.main:app --host 127.0.0.1 --port 8010",
].join(" && ");

/**
 * Playwright E2E 配置。
 *
 * 本地只需先启动 postgres / redis / minio；Playwright 会创建并迁移
 * annotation_e2e，再自启 8010 API 和 3001 Web，避免复用开发服务。
 *
 * CI 中通过 webServer 启动 vite preview，使用真实后端 API。
 */
export default defineConfig({
  testDir: "./e2e",
  // v0.8.7 F4 · 默认 test:e2e 只跑 e2e/tests/**；截图自动化在 e2e/screenshots/，
  // 通过 `pnpm screenshots --testMatch '**/screenshots/**/*.spec.ts'` 显式触发，
  // 不进 CI 避免 baseline drift / flaky。
  testMatch: ["**/tests/**/*.spec.ts"],
  // v0.8.5 · seed/reset 是数据库 TRUNCATE 全局操作，多 spec 并发会互相覆盖（auth /
  // annotation / batch-flow 三 spec 共用同一个 fixture），本地与 CI 都用单 worker。
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI ? [["github"], ["html"]] : "html",

  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? defaultBaseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // 3D 点云 spec 交给下方 pointcloud project(需 WebGL 软渲染参数),此处排除。
      testIgnore: ["**/workbench-pointcloud*.spec.ts"],
    },
    // v0.16.x · 3D 点云 spec 单列:headless Chromium 默认无 GPU,Three.js/WebGL 跑不起来;
    // 经 ANGLE 走 SwiftShader 软渲染(新版 Chromium 的 WebGL SwiftShader 需 unsafe 旗标显式放行)。
    {
      name: "pointcloud",
      testMatch: ["**/workbench-pointcloud*.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
    // 起步只跑 chromium；稳定后再加 firefox/webkit
  ],

  webServer: useIsolatedServers
    ? [
        {
          command: isolatedApiCommand,
          cwd: resolve(configDir, "../api"),
          env: {
            DATABASE_URL: e2eDatabaseURL,
            ENVIRONMENT: "development",
            E2E_SEED_ENABLED: "true",
            ...(rasterMaskMatrix
              ? {
                  RASTER_MASK_READ_ENABLED: "true",
                  RASTER_MASK_CREATE_ENABLED: rasterMaskCreateEnabled ? "true" : "false",
                }
              : {}),
          },
          url: "http://127.0.0.1:8010/health/db",
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: "pnpm dev --host 127.0.0.1",
          cwd: configDir,
          env: {
            API_PROXY_TARGET: "http://127.0.0.1:8010",
            VITE_WS_HOST: "127.0.0.1:8010",
            PORT: "3001",
          },
          url: "http://127.0.0.1:3001",
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ]
    : isCI
      ? {
          command: "pnpm preview --host 127.0.0.1 --port 3000",
          url: "http://127.0.0.1:3000",
          reuseExistingServer: false,
          timeout: 120_000,
        }
      : undefined,
});
