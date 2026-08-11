/**
 * 流程录制：两条轨迹进入下一帧后，用 Tab 在续写虚影间切换并拖动续写。
 */
import type { Locator, Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

async function drawTrack(
  page: Page,
  stage: Locator,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  const box = await stage.boundingBox();
  if (!box) throw new Error("[video-track-carryover] 视频画布不可见");
  const start = { x: box.x + box.width * from[0], y: box.y + box.height * from[1] };
  const end = { x: box.x + box.width * to[0], y: box.y + box.height * to[1] };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.getByTestId("class-picker-popover").waitFor({ timeout: 3_000 });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("/annotations"),
      { timeout: 5_000 },
    ),
    page.keyboard.press("Enter"),
  ]);
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
  await trackButton.click();
  await drawTrack(page, stage, [0.2, 0.38], [0.36, 0.64]);
  await page.keyboard.press("Escape");
  await trackButton.click();
  await drawTrack(page, stage, [0.58, 0.34], [0.74, 0.6]);

  await page.getByTestId("video-track-row").nth(1).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(600);

  const drawStartMs = Date.now();
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

  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error("[video-track-carryover] 视频画布不可见");
  const startX = stageBox.x + stageBox.width * 0.28;
  const startY = stageBox.y + stageBox.height * 0.51;
  const updated = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().includes("/annotations/"),
    { timeout: 5_000 },
  );
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + stageBox.width * 0.05, startY - stageBox.height * 0.025, {
    steps: 14,
  });
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
