/**
 * 流程录制：只让一个真实高清切片请求失败一次，展示调度器自动重签与恢复。
 */
import type { Page, Response } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

function isPyramidSummary(response: Response, taskId: string): boolean {
  return response.url().includes(`/tasks/${taskId}/image-pyramid`);
}

function pyramidTilePath(requestUrl: string): string | null {
  const pathname = new URL(requestUrl).pathname;
  return pathname.includes("/image-pyramids/") && pathname.includes("/tiles/") ? pathname : null;
}

interface PyramidManifestSummary {
  manifest?: {
    width: number;
    tileSize: number;
    levels: Array<{ level: number; scaleFactor: number }>;
  };
}

interface TileDiagnostics {
  currentLevel?: number;
  errors?: number;
  retryingVisibleTiles?: number;
  targetCoverageRatio?: number;
  urlRefreshes?: number;
}

async function tileDiagnostics(page: Page): Promise<TileDiagnostics | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __imageTileDiagnostics?: { resources?: TileDiagnostics };
        }
      ).__imageTileDiagnostics?.resources,
  );
}

async function waitForFullTileCoverage(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const diagnostics = (
        window as unknown as {
          __imageTileDiagnostics?: {
            resources?: { targetCoverageRatio?: number; retryingVisibleTiles?: number };
          };
        }
      ).__imageTileDiagnostics?.resources;
      return diagnostics?.targetCoverageRatio === 1 && diagnostics.retryingVisibleTiles === 0;
    },
    undefined,
    { timeout: 15_000 },
  );
}

export async function runLargeImagePyramidRecovery(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.large_image_demo;
  if (!project) {
    throw new Error(
      "[large-image-pyramid-recovery] 截图库缺少 large_image_demo，请先生成 P-LARGE-IMG 的 Cosmic Cliffs 图像金字塔",
    );
  }
  const task = project.tasks.cosmic_cliffs;
  if (!task) {
    throw new Error("[large-image-pyramid-recovery] large_image_demo 缺少 cosmic_cliffs 任务");
  }

  let faultArmed = false;
  let targetTileSuffix: string | null = null;
  let failedTilePath: string | null = null;
  let targetAttempts = 0;
  let injectedFailures = 0;
  await page.route(/\/image-pyramids\/.*\/tiles\/.*\.webp/, async (route) => {
    const path = pyramidTilePath(route.request().url());
    if (!faultArmed || !path || !targetTileSuffix || !path.endsWith(targetTileSuffix)) {
      await route.continue();
      return;
    }
    failedTilePath ??= path;
    if (path !== failedTilePath) {
      await route.continue();
      return;
    }

    targetAttempts += 1;
    if (targetAttempts === 1) {
      // 让 overview 在失败期间保持可见，也让观众能辨认失败与自动重试的因果关系。
      await page.waitForTimeout(800);
      injectedFailures += 1;
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
        body: "recording-only single tile outage",
      });
      return;
    }

    if (targetAttempts === 2) await page.waitForTimeout(2_200);
    await route.continue();
  });

  const pyramidReady = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && isPyramidSummary(response, task.id) && response.ok(),
    { timeout: 20_000 },
  );
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  const pyramidResponse = await pyramidReady;
  const manifest = ((await pyramidResponse.json()) as PyramidManifestSummary).manifest;
  if (!manifest) throw new Error("[large-image-pyramid-recovery] 大图接口未返回 manifest");
  const stage = page.getByTestId("workbench-stage");
  await stage.waitFor({ state: "visible", timeout: 15_000 });
  await waitForFullTileCoverage(page);

  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error("[large-image-pyramid-recovery] 大图画布不可见");

  const drawStartMs = Date.now();
  await page.waitForTimeout(1_500);

  const zoomX = stageBox.x + stageBox.width * 0.62;
  const zoomY = stageBox.y + stageBox.height * 0.48;
  await page.mouse.move(zoomX, zoomY);
  await page.keyboard.down("Control");
  // 先进入局部高清层，但暂不注入故障，保留从全景到细节的完整镜头。
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(260);
  }
  await page.keyboard.up("Control");
  await waitForFullTileCoverage(page);

  // 接近下一层 LOD 边界；在视口稳定后再选定焦点下方的可见切片。
  await page.keyboard.down("Control");
  for (let index = 0; index < 5; index += 1) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(260);
  }
  await page.keyboard.up("Control");
  await waitForFullTileCoverage(page);

  const currentLevel = (await tileDiagnostics(page))?.currentLevel;
  if (currentLevel == null || currentLevel <= 0) {
    throw new Error(`[large-image-pyramid-recovery] 无法从 L${currentLevel ?? "?"} 进入更高清层`);
  }
  const targetLevel = currentLevel - 1;
  const targetLevelSpec = manifest.levels.find((level) => level.level === targetLevel);
  if (!targetLevelSpec) {
    throw new Error(`[large-image-pyramid-recovery] manifest 缺少 L${targetLevel}`);
  }
  const targetCoordinate = await stage.evaluate(
    (element, values) => {
      const mediaX = Number(element.getAttribute("data-media-x"));
      const mediaY = Number(element.getAttribute("data-media-y"));
      const mediaWidth = Number(element.getAttribute("data-media-width"));
      const scale = mediaWidth / values.imageWidth;
      const worldTileSize = values.tileSize * values.scaleFactor;
      return {
        x: Math.floor((values.focusX - mediaX) / scale / worldTileSize),
        y: Math.floor((values.focusY - mediaY) / scale / worldTileSize),
      };
    },
    {
      focusX: zoomX - stageBox.x,
      focusY: zoomY - stageBox.y,
      imageWidth: manifest.width,
      tileSize: manifest.tileSize,
      scaleFactor: targetLevelSpec.scaleFactor,
    },
  );
  targetTileSuffix = `/tiles/${targetLevel}/${targetCoordinate.x}/${targetCoordinate.y}.webp`;
  faultArmed = true;

  await page.keyboard.down("Control");
  let reachedTargetLevel = false;
  for (let index = 0; index < 5; index += 1) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(280);
    reachedTargetLevel = (await tileDiagnostics(page))?.currentLevel === targetLevel;
    if (reachedTargetLevel) break;
  }
  await page.keyboard.up("Control");
  if (!reachedTargetLevel) {
    throw new Error(`[large-image-pyramid-recovery] 缩放后未进入目标 L${targetLevel}`);
  }

  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="workbench-stage"]')
        ?.getAttribute("data-image-tile-retrying") === "true",
    undefined,
    { timeout: 10_000 },
  );
  await page.getByRole("status").filter({ hasText: "正在自动重试" }).waitFor({
    state: "visible",
    timeout: 5_000,
  });
  await waitForFullTileCoverage(page);
  await page.waitForTimeout(1_300);

  const panStart = {
    x: stageBox.x + stageBox.width * 0.54,
    y: stageBox.y + stageBox.height * 0.52,
  };
  await page.keyboard.down("Space");
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(
    page,
    panStart,
    {
      x: panStart.x - stageBox.width * 0.17,
      y: panStart.y + stageBox.height * 0.09,
    },
    1_250,
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
  await waitForFullTileCoverage(page);
  await page.waitForTimeout(1_200);

  await page.mouse.move(stageBox.x + stageBox.width * 0.43, stageBox.y + stageBox.height * 0.4);
  await page.keyboard.down("Control");
  for (let index = 0; index < 2; index += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(280);
  }
  await page.keyboard.up("Control");
  await waitForFullTileCoverage(page);
  await page.waitForTimeout(1_200);

  const secondPan = {
    x: stageBox.x + stageBox.width * 0.48,
    y: stageBox.y + stageBox.height * 0.48,
  };
  await page.keyboard.down("Space");
  await page.mouse.move(secondPan.x, secondPan.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(
    page,
    secondPan,
    {
      x: secondPan.x + stageBox.width * 0.13,
      y: secondPan.y - stageBox.height * 0.07,
    },
    1_100,
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
  await waitForFullTileCoverage(page);
  await page.waitForTimeout(1_400);

  const diagnostics = await tileDiagnostics(page);
  if (
    injectedFailures !== 1 ||
    targetAttempts < 2 ||
    !failedTilePath ||
    (diagnostics?.errors ?? 0) < 1 ||
    (diagnostics?.urlRefreshes ?? 0) < 1 ||
    diagnostics?.targetCoverageRatio !== 1
  ) {
    throw new Error(
      `[large-image-pyramid-recovery] 恢复链路未闭环：${JSON.stringify({
        injectedFailures,
        targetAttempts,
        failedTilePath,
        diagnostics,
      })}`,
    );
  }

  return { drawStartMs, drawEndMs: Date.now() };
}
