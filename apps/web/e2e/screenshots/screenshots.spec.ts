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
 *   - tablet                → 追加 .tablet 后缀
 *   - mobile                → 追加 .mobile 后缀
 */
import { test } from "../fixtures/seed";
import type { SeedData } from "../fixtures/seed";
import { SCENES } from "./scenes/index";
import type { Role, MatrixAxis, ScreenshotScene } from "./scenes/index";
import { injectAnnotations } from "./_helpers/annotate";
import { setupMockState } from "./_helpers/mock-state";
import path from "path";
import fs from "fs";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/?$/, "");
const MANIFEST_PATH = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/manifest.json");

// Playwright project name → MatrixAxis
const PROJECT_AXIS: Record<string, MatrixAxis> = {
  "desktop-light": { viewport: "desktop", theme: "light", locale: "zh-CN" },
  "desktop-dark":  { viewport: "desktop", theme: "dark",  locale: "zh-CN" },
  "tablet":        { viewport: "tablet",  theme: "light", locale: "zh-CN" },
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

const manifest: Record<string, ManifestEntry> = {};

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

test.describe("screenshots automation", () => {
  let cached: SeedData | null = null;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(
      `${process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000"}/api/v1/__test/seed/peek`,
    );
    if (!res.ok()) {
      throw new Error(`seed/peek failed: ${res.status()} ${await res.text()}`);
    }
    const peek = (await res.json()) as {
      admin_email: string | null;
      project_id: string | null;
      task_id: string | null;
    };
    if (!peek.admin_email) {
      throw new Error(
        "seed/peek 找不到 super_admin 用户。请先跑 `cd apps/api && PYTHONPATH=. uv run python scripts/seed.py`。",
      );
    }
    cached = {
      admin_email:     peek.admin_email,
      annotator_email: peek.admin_email,
      reviewer_email:  peek.admin_email,
      project_id:      peek.project_id ?? "",
      task_ids:        peek.task_id ? [peek.task_id] : [],
      ml_backend_id:   "",
    };
  });

  test.afterAll(() => {
    // 写 manifest.json（供 M4 文档站组件 + screenshots:lint 使用）
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  });

  for (const scene of SCENES) {
    test(scene.name, async ({ page, seed }, info) => {
      if (!cached) throw new Error("seed peek 未完成");
      const data = cached;

      // 获取当前 Playwright project 对应的矩阵轴
      const axis = PROJECT_AXIS[info.project.name] ?? PROJECT_AXIS["desktop-light"];

      // 不在此 project 跑的 scene 直接 skip
      if (!shouldRunInProject(scene, axis)) {
        test.skip();
        return;
      }

      // 缺关键数据时 skip
      const route = scene.route(data);
      if (route.includes(data.project_id || "__NONE__") && !data.project_id) {
        info.annotations.push({ type: "skipped", description: "无项目数据：跑 seed.py 或新建项目" });
        test.skip();
      }
      if (data.task_ids.length === 0 && route.includes("task=")) {
        info.annotations.push({ type: "skipped", description: "无任务数据：在项目内上传图片后重跑" });
        test.skip();
      }

      const emailMap: Record<Role, string> = {
        admin:     data.admin_email,
        annotator: data.annotator_email,
        reviewer:  data.reviewer_email,
      };
      const roleEmail = Array.isArray(scene.role)
        ? emailMap[scene.role[0]]
        : emailMap[scene.role];

      // 激活网络 mock（如有）
      const cleanupMock = await setupMockState(page, scene.mockState);

      await seed.injectToken(page, roleEmail);
      await page.goto(route);
      if (scene.prepare) await scene.prepare(page, data);

      // 禁用动画，等待网络稳定
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
      });
      await page.waitForLoadState("networkidle");

      // 注入 SVG 注释 overlay（如有）
      const cleanupAnnotations = await injectAnnotations(page, scene.annotate);

      // 合并默认 mask + scene 级 mask
      const maskSelectors = [...DEFAULT_MASK_SELECTORS, ...(scene.mask ?? [])];
      const maskLocators  = maskSelectors.map((sel) => page.locator(sel));

      // 确保输出目录存在
      const outRelative = resolveOutputPath(scene, axis);
      const out = `${REPO_ROOT}/${outRelative}`;
      fs.mkdirSync(path.dirname(out), { recursive: true });

      // 按 capture 模式截图
      const capture = scene.capture;

      if (!capture) {
        await page.screenshot({ path: out, fullPage: false, animations: "disabled", mask: maskLocators });
      } else if (capture.kind === "fullPage") {
        await page.screenshot({ path: out, fullPage: true, animations: "disabled", mask: maskLocators });
      } else if (capture.kind === "locator") {
        // timeout:0 → 不等待，元素不存在时直接 null/throw；fallback 到 viewport 截图
        const locator = page.locator(capture.selector);
        let box: { x: number; y: number; width: number; height: number } | null = null;
        try {
          box = await locator.boundingBox(
            { timeout: 0 } as Parameters<typeof locator.boundingBox>[0],
          );
        } catch {
          // 元素不存在或不可见，fallback
        }

        if (!box) {
          await page.screenshot({ path: out, fullPage: false, animations: "disabled", mask: maskLocators });
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
        await page.screenshot({ path: out, animations: "disabled", mask: maskLocators, clip: capture.rect });
      }

      // 清理
      await cleanupAnnotations();
      await cleanupMock();

      // 更新 manifest
      manifest[outRelative] = {
        auto: true,
        scene: scene.name,
        lastRun: new Date().toISOString(),
        project: info.project.name,
      };

      info.annotations.push({ type: "screenshot", description: outRelative });
    });
  }
});
