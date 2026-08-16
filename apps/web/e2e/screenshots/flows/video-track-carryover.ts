/**
 * 流程录制：两条轨迹进入下一帧后，用 Tab 在续写虚影间切换并拖动续写。
 */
import type { Locator, Page } from "@playwright/test";
import type { ScreenshotRecordingAnchor, ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  mediaBbox,
  mediaPoint,
  movePointerAtRefreshRate,
  recordingAnchor,
  renderedMediaBounds,
  selectVideoRecordingClass,
  commitPendingAnnotationClass,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

async function drawTrack(
  page: Page,
  stage: Locator,
  anchor: ScreenshotRecordingAnchor,
  taskId: string | number,
): Promise<void> {
  await selectVideoRecordingClass(page, stage, anchor.label);
  const box = await renderedMediaBounds(stage);
  const { start, end } = mediaBbox(box, anchor.bbox);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, start, end, 650);
  await page.mouse.up();
  await commitPendingAnnotationClass(page, { label: anchor.label, taskId });
  await page.waitForTimeout(650);
}

export async function runVideoTrackCarryover(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const stage = page.getByTestId("video-konva-stage");
  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15_000 });
  await stage.waitFor({ timeout: 10_000 });

  const trackButton = page.getByTestId("video-tool-btn-track");
  const leftBus = recordingAnchor(catalog, "video_demo", "tracking", "left_bus_f0", 0);
  const frontTruck = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f0", 0);
  await trackButton.click();
  const drawStartMs = Date.now();
  await drawTrack(page, stage, leftBus, project.tasks.tracking.id);
  await page.keyboard.press("Escape");
  await trackButton.click();
  await drawTrack(page, stage, frontTruck, project.tasks.tracking.id);

  await page.getByTestId("video-track-row").nth(1).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(600);

  await page.keyboard.press("ArrowRight");
  const hint = page.getByTestId("video-sticky-track-hint");
  await hint.waitFor({ timeout: 3_000 });
  const initialHint = await hint.textContent();
  if (!initialHint) throw new Error("[video-track-carryover] 进入下一帧后缺少轨迹续写提示");
  await page.waitForTimeout(900);

  await page.keyboard.press("Tab");
  await page.waitForFunction(
    (previous) =>
      document.querySelector('[data-testid="video-sticky-track-hint"]')?.textContent !== previous,
    initialHint,
    { timeout: 3_000 },
  );
  await page.waitForTimeout(650);

  const stageBox = await renderedMediaBounds(stage);
  const nextFrame = recordingAnchor(catalog, "video_demo", "tracking", "left_bus_f1", 1);
  const [dragFrom, dragTo] = nextFrame.polyline;
  if (!dragFrom || !dragTo) {
    throw new Error("[video-track-carryover] left_bus_f1 缺少续写拖动路径锚点");
  }
  const start = mediaPoint(stageBox, dragFrom);
  const end = mediaPoint(stageBox, dragTo);
  const updated = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().includes("/annotations/"),
    { timeout: 20_000 },
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, start, end, 700);
  await page.mouse.up();
  await updated;

  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="video-sticky-track-hint"]')?.textContent === expected,
    initialHint,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(1_000);
  return { drawStartMs, drawEndMs: Date.now() };
}
