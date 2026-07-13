/**
 * v2 · 截图自动化主 driver。
 *
 * 执行：`pnpm screenshots`（手动触发，不进 CI）
 *
 * 前置条件：
 *   1. docker compose up -d
 *   2. uv run alembic upgrade head (apps/api)
 *   3. uv run uvicorn app.main:app --port 8000
 *   4. pnpm dev  (apps/web)
 *   5. cd apps/api && PYTHONPATH=. uv run python scripts/seed.py
 *
 * 矩阵规则：
 *   - scene 不声明 matrix → 只跑 desktop-light project
 *   - scene 声明 matrix.themes:['light','dark'] → desktop-light + desktop-dark 都跑
 *   - scene 声明 matrix.viewports:['desktop','mobile'] → desktop-light + mobile 都跑
 *
 * 输出路径规则：
 *   - desktop-light（默认）→ 原 target 路径不加后缀
 *   - desktop-dark          → 追加 .dark 后缀
 *   - mobile                → 追加 .mobile 后缀
 */
import { test } from "../fixtures/seed";
import type { ScreenshotSeedCatalog } from "../fixtures/seed";
import type { Page } from "@playwright/test";
import { SCENES } from "./scenes/index";
import type { Role, MatrixAxis, ScreenshotScene } from "./scenes/index";
import { injectAnnotations } from "./_helpers/annotate";
import { setupMockState } from "./_helpers/mock-state";
import { validateScreenshotFixture } from "./catalog";
import { installScreenshotEnvironment, waitForScreenshotReady } from "./environment";
import path from "path";
import fs from "fs";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/?$/, "");
const MANIFEST_PATH = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/manifest.json");
const VALIDATE_ONLY = process.env.SCREENSHOT_VALIDATE_ONLY === "1";

// Playwright project name → MatrixAxis
const PROJECT_AXIS: Record<string, MatrixAxis> = {
  "desktop-light": { viewport: "desktop", theme: "light", locale: "zh-CN" },
  "desktop-dark":  { viewport: "desktop", theme: "dark",  locale: "zh-CN" },
  "mobile":        { viewport: "mobile",  theme: "light", locale: "zh-CN" },
};

// 全局默认 mask 选择器（时间戳 / 头像 / 显式标记元素）
const DEFAULT_MASK_SELECTORS = [
  "[data-screenshot-mask]",
  "[data-testid='user-avatar']",
  "time[datetime]",
];

type ManifestEntry = {
  auto: boolean;
  scene: string;
  lastRun: string;
  project: string;
};

function readExistingManifest(): Record<string, ManifestEntry> {
  if (!fs.existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Record<string, ManifestEntry>;
  } catch {
    return {};
  }
}

const manifest: Record<string, ManifestEntry> = readExistingManifest();

/** 判断 scene 是否应在当前 Playwright project 中跑 */
function shouldRunInProject(scene: ScreenshotScene, axis: MatrixAxis): boolean {
  if (!scene.matrix) {
    return axis.viewport === "desktop" && axis.theme === "light";
  }
  const viewports = scene.matrix.viewports ?? ["desktop"];
  const themes    = scene.matrix.themes    ?? ["light"];
  return viewports.includes(axis.viewport) && themes.includes(axis.theme);
}

/** 根据矩阵轴生成带后缀的输出路径 */
function resolveOutputPath(scene: ScreenshotScene, axis: MatrixAxis): string {
  const base = typeof scene.target === "function" ? scene.target(axis) : scene.target;
  const isDefault =
    axis.viewport === "desktop" && axis.theme === "light" && axis.locale === "zh-CN";
  if (isDefault) return base;

  const ext  = path.extname(base);
  const stem = base.slice(0, -ext.length);
  const parts = [
    axis.theme    !== "light"   ? axis.theme    : null,
    axis.viewport !== "desktop" ? axis.viewport : null,
    axis.locale   !== "zh-CN"   ? axis.locale   : null,
  ].filter(Boolean);

  return `${stem}.${parts.join(".")}${ext}`;
}

async function applyScreenshotTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((nextTheme) => {
    localStorage.setItem("anno.theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;

    const raw = localStorage.getItem("auth-storage");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        state?: { user?: { preferences?: { ui?: Record<string, unknown> } | null } | null };
      };
      const user = parsed.state?.user;
      if (!user) return;
      const preferences = user.preferences ?? {};
      const ui = preferences.ui ?? {};
      user.preferences = { ...preferences, ui: { ...ui, theme: nextTheme } };
      localStorage.setItem("auth-storage", JSON.stringify(parsed));
    } catch {
      // Corrupt persisted auth should not make screenshot generation fail.
    }
  }, theme);
}

test.describe("screenshots automation", () => {
  let cached: ScreenshotSeedCatalog | null = null;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(
      `${process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000"}/api/v1/__test/seed/catalog?profile=screenshots`,
    );
    if (!res.ok()) {
      throw new Error(
        `seed/catalog failed: ${res.status()} ${await res.text()}\n` +
          "请先运行 screenshots seed，并确保 live backend 或 protocol stub 已启动。",
      );
    }
    cached = (await res.json()) as ScreenshotSeedCatalog;
  });

  test.afterAll(() => {
    if (VALIDATE_ONLY) return;
    // 写 manifest.json（供 M4 文档站组件 + screenshots:lint 使用）
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  });

  for (const scene of SCENES) {
    test(scene.name, async ({ page, seed }, info) => {
      if (!cached) throw new Error("screenshot seed catalog 未完成");
      const catalog = cached;

      // 获取当前 Playwright project 对应的矩阵轴
      const axis = PROJECT_AXIS[info.project.name] ?? PROJECT_AXIS["desktop-light"];

      // 不在此 project 跑的 scene 直接 skip
      if (!shouldRunInProject(scene, axis)) {
        test.skip();
        return;
      }

      validateScreenshotFixture(scene.name, scene.fixture, catalog);
      const route = scene.route(catalog);

      const emailMap: Record<Role, string> = {
        admin:     catalog.users.admin.email,
        annotator: catalog.users.annotator.email,
        reviewer:  catalog.users.reviewer.email,
      };
      const roleEmail = Array.isArray(scene.role)
        ? emailMap[scene.role[0]]
        : emailMap[scene.role];

      // 激活网络 mock（如有）
      const cleanupMock = await setupMockState(page, scene.mockState);

      await installScreenshotEnvironment(page);
      await seed.injectToken(page, roleEmail);
      await applyScreenshotTheme(page, axis.theme);
      await page.goto(route);
      if (scene.prepare) await scene.prepare(page, catalog);
      await applyScreenshotTheme(page, axis.theme);
      await waitForScreenshotReady(page);

      // 注入 SVG 注释 overlay（如有）
      const cleanupAnnotations = await injectAnnotations(page, scene.annotate);

      // 合并默认 mask + scene 级 mask
      const maskSelectors = [...DEFAULT_MASK_SELECTORS, ...(scene.mask ?? [])];
      const maskLocators  = maskSelectors.map((sel) => page.locator(sel));

      // 确保输出目录存在
      const outRelative = resolveOutputPath(scene, axis);
      const out = `${REPO_ROOT}/${outRelative}`;
      if (!VALIDATE_ONLY) fs.mkdirSync(path.dirname(out), { recursive: true });

      // 按 capture 模式截图
      const capture = scene.capture;

      if (!capture) {
        if (!VALIDATE_ONLY) {
          await page.screenshot({ path: out, fullPage: false, animations: "disabled", mask: maskLocators });
        }
      } else if (capture.kind === "fullPage") {
        if (!VALIDATE_ONLY) {
          await page.screenshot({ path: out, fullPage: true, animations: "disabled", mask: maskLocators });
        }
      } else if (capture.kind === "locator") {
        const locator = page.locator(capture.selector);
        await locator.waitFor({ state: "visible", timeout: 10_000 });
        const box = await locator.boundingBox();
        if (!box) {
          throw new Error(`${scene.name}: 截图目标 ${capture.selector} 没有可见边界`);
        }
        if (VALIDATE_ONLY) {
          // locator 的可见性与边界已经在上方验证，无需写文件。
        } else if (capture.padding) {
          await page.screenshot({
            path: out,
            animations: "disabled",
            mask: maskLocators,
            clip: {
              x:      Math.max(0, box.x - capture.padding),
              y:      Math.max(0, box.y - capture.padding),
              width:  box.width  + capture.padding * 2,
              height: box.height + capture.padding * 2,
            },
          });
        } else {
          await page.screenshot({
            path: out,
            animations: "disabled",
            mask: maskLocators,
            clip: { x: box.x, y: box.y, width: box.width, height: box.height },
          });
        }
      } else if (capture.kind === "clip") {
        if (!VALIDATE_ONLY) {
          await page.screenshot({ path: out, animations: "disabled", mask: maskLocators, clip: capture.rect });
        }
      }

      // 清理
      await cleanupAnnotations();
      await cleanupMock();

      // 更新 manifest
      if (!VALIDATE_ONLY) {
        manifest[outRelative] = {
          auto: true,
          scene: scene.name,
          lastRun: new Date().toISOString(),
          project: info.project.name,
        };
      }

      info.annotations.push({ type: "screenshot", description: outRelative });
    });
  }
});
