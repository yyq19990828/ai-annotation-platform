/**
 * 流程录制：AI 追踪面板——顶部打开、拖动、缩放、重开恢复与 AI 单题互斥。
 *
 * 本 flow 不发起 tracker job，不修改标注数据；账号级偏好写入由录制沙箱隔离。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runAiTrackerPanel(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.evaluate(() => {
    localStorage.removeItem("wb:video-tracker-panel-position");
    localStorage.removeItem("wb:video-tracker-panel-size");
  });
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15_000 });
  await page.getByTestId("video-konva-stage").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const trackerButton = page.getByTestId("workbench-ai-tracker");
  const singleButton = page.getByTestId("workbench-ai-single");
  const tracker = page.getByTestId("video-tracker-propagate-dialog");
  const single = page.getByTestId("ai-prediction-popover");
  const drawStartMs = Date.now();

  await trackerButton.click();
  await tracker.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(900);

  const header = page.getByTestId("tracker-panel-header");
  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error("[ai-tracker-panel] 追踪面板头部不可见");
  const headerX = headerBox.x + headerBox.width / 2;
  const headerY = headerBox.y + 18;
  await page.mouse.move(headerX, headerY);
  await page.mouse.down();
  await movePointerAtRefreshRate(
    page,
    { x: headerX, y: headerY },
    { x: headerX - 150, y: headerY + 24 },
    650,
  );
  await page.mouse.up();
  await page.waitForTimeout(800);

  const handle = page.getByTestId("tracker-panel-resize-handle");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("[ai-tracker-panel] 追踪面板缩放手柄不可见");
  const handleX = handleBox.x + handleBox.width / 2;
  const handleY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await movePointerAtRefreshRate(
    page,
    { x: handleX, y: handleY },
    { x: handleX + 60, y: handleY - 70 },
    650,
  );
  await page.mouse.up();
  await page.waitForTimeout(800);

  await trackerButton.click();
  await tracker.waitFor({ state: "hidden", timeout: 3000 });
  await page.waitForTimeout(350);
  await trackerButton.click();
  await tracker.waitFor({ state: "visible", timeout: 3000 });
  await page.waitForTimeout(800);

  await singleButton.click();
  await single.waitFor({ state: "visible", timeout: 3000 });
  await tracker.waitFor({ state: "hidden", timeout: 3000 });
  await page.waitForTimeout(800);

  await trackerButton.click();
  await tracker.waitFor({ state: "visible", timeout: 3000 });
  await single.waitFor({ state: "hidden", timeout: 3000 });
  await page.waitForTimeout(900);

  return { drawStartMs, drawEndMs: Date.now() };
}
