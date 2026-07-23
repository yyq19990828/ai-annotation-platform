/**
 * 高价值视觉回归子集。数据、角色、ML Backend 与准备逻辑全部复用
 * screenshot catalog 及正式 scene，CI 通过 protocol stub 提供确定性能力。
 */
import { expect, test } from "../../fixtures/seed";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { Page } from "@playwright/test";
import { injectAnnotations } from "../_helpers/annotate";
import { setupMockState } from "../_helpers/mock-state";
import { validateScreenshotFixture } from "../catalog";
import { loadScreenshotCatalog } from "../catalog-runtime";
import {
  applyScreenshotTheme,
  installScreenshotEnvironment,
  waitForScreenshotReady,
} from "../environment";
import { SCENES } from "../scenes";
import type { ResolvedScreenshotScene, Role } from "../scenes";

const REGRESSION_SCENES = [
  "getting-started/login",
  "projects/data-manager-overview",
  "workbench/layout-overview",
  "sam/interactive-toolbar",
  "review/workbench",
  "export/format-select",
  "projects/ai-pre-config-panel",
  "workbench/video-real-scene",
  "workbench/video-ai-tracking-panel",
] as const;

const DEFAULT_MASK_SELECTORS = [
  "[data-screenshot-mask]",
  "[data-testid='user-avatar']",
  "time[datetime]",
];

function selectedScenes(): ResolvedScreenshotScene[] {
  return REGRESSION_SCENES.map((name) => {
    const scene = SCENES.find((candidate) => candidate.name === name);
    if (!scene) throw new Error(`视觉回归 scene 不存在: ${name}`);
    return scene;
  });
}

async function captureRegression(page: Page, scene: ResolvedScreenshotScene): Promise<void> {
  const name = `${scene.name.replaceAll("/", "--")}.png`;
  const mask = [...DEFAULT_MASK_SELECTORS, ...(scene.mask ?? [])].map((selector) =>
    page.locator(selector));
  const common = { animations: "disabled" as const, maxDiffPixelRatio: 0.01, mask };
  const capture = scene.capture;
  if (!capture) {
    await expect(page).toHaveScreenshot(name, common);
    return;
  }
  if (capture.kind === "fullPage") {
    await expect(page).toHaveScreenshot(name, { ...common, fullPage: true });
    return;
  }
  if (capture.kind === "clip") {
    await expect(page).toHaveScreenshot(name, { ...common, clip: capture.rect });
    return;
  }

  const locator = page.locator(capture.selector);
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${scene.name}: 视觉回归目标没有可见边界`);
  const padding = capture.padding ?? 0;
  await expect(page).toHaveScreenshot(name, {
    ...common,
    clip: {
      x: Math.max(0, box.x - padding),
      y: Math.max(0, box.y - padding),
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    },
  });
}

test.describe("visual regression", () => {
  let catalog: ScreenshotSeedCatalog | null = null;

  test.beforeAll(() => {
    catalog = loadScreenshotCatalog();
  });

  for (const scene of selectedScenes()) {
    test(scene.name, async ({ page, seed }) => {
      if (!catalog) throw new Error("screenshot seed catalog 未完成");
      validateScreenshotFixture(scene.name, scene.fixture, catalog);

      const emailByRole: Record<Role, string> = {
        admin: catalog.users.admin.email,
        annotator: catalog.users.annotator.email,
        reviewer: catalog.users.reviewer.email,
      };
      const role = Array.isArray(scene.role) ? scene.role[0] : scene.role;

      let cleanupMock: () => Promise<void> = async () => {};
      let cleanupAnnotations: () => Promise<void> = async () => {};

      try {
        await installScreenshotEnvironment(page);
        await seed.injectToken(page, emailByRole[role]);
        await applyScreenshotTheme(page, "light");
        cleanupMock = await setupMockState(page, scene.mockState);
        await page.goto(scene.route(catalog));
        if (scene.prepare) await scene.prepare(page, catalog);
        await applyScreenshotTheme(page, "light");
        await waitForScreenshotReady(page);
        cleanupAnnotations = await injectAnnotations(page, scene.annotate);

        await captureRegression(page, scene);
      } finally {
        try {
          await cleanupAnnotations();
        } finally {
          try {
            await cleanupMock();
          } finally {
            // scene.prepare 也可能注册局部 route；测试失败时一并清除。
            await page.unrouteAll({ behavior: "ignoreErrors" });
          }
        }
      }
    });
  }
});
