/**
 * 流程录制：视频时间轴以指针帧为锚缩放、横向平移并复位。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runVideoTimelineZoom(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const timeline = page.getByTestId("video-timeline-shell");
  await timeline.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("video-timeline-window-readout").waitFor({ timeout: 10_000 });
  await page.addStyleTag({
    content: '[data-testid="video-frame-preview-popover"] { display: none !important; }',
  });
  await page.waitForTimeout(900);

  const box = await timeline.boundingBox();
  if (!box) throw new Error("[video-timeline-zoom] 时间轴不可见");
  const anchorX = box.x + box.width * 0.64;
  const anchorY = box.y + box.height * 0.55;
  await page.mouse.move(anchorX, anchorY);

  const drawStartMs = Date.now();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -420);
  await page.keyboard.up("Control");
  await page.waitForTimeout(900);

  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(900);

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(900);

  // 折叠态不渲染展开控制条的“适配全部”按钮；双击时间轴是等价的
  // 常驻复位入口，也是用户指南要展示的手势。
  await timeline.dblclick({ position: { x: box.width * 0.64, y: box.height * 0.55 } });
  await page.waitForTimeout(900);
  return { drawStartMs, drawEndMs: Date.now() };
}
