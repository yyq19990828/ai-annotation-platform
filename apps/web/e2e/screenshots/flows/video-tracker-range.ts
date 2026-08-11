/**
 * 流程录制：打开 AI 追踪面板后 Shift+拖选时间轴，自定义影响范围同步回填。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runVideoTrackerRange(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const timeline = page.getByTestId("video-timeline-shell");
  await timeline.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("video-konva-stage").waitFor({ timeout: 10_000 });
  await page.addStyleTag({
    content: '[data-testid="video-frame-preview-popover"] { display: none !important; }',
  });
  await page.waitForTimeout(800);

  const drawStartMs = Date.now();
  await page.getByTestId("workbench-ai-tracker").click();
  await page.getByTestId("video-tracker-propagate-dialog").waitFor({ timeout: 5_000 });
  await page.waitForTimeout(900);

  const box = await timeline.boundingBox();
  if (!box) throw new Error("[video-tracker-range] 时间轴不可见");
  const startX = box.x + box.width * 0.22;
  const endX = box.x + box.width * 0.68;
  const y = box.y + box.height * 0.55;
  await page.keyboard.down("Shift");
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 20 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await page.getByTestId("tracker-range-custom").waitFor({ timeout: 5_000 });
  await page.waitForTimeout(1400);
  return { drawStartMs, drawEndMs: Date.now() };
}
