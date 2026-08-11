/**
 * 流程录制：从空白创建视频 Mask 轨迹，再在后续帧物化新关键帧。
 *
 * Mask 轨迹属于轨迹工具组，不使用单帧 Mask 的 M 快捷键。流程会落库，
 * 由 flows.spec 的 afterAll 重建 screenshots seed 清理。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

async function stroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function confirmMask(page: Page, chooseClass: boolean) {
  await page.keyboard.press("Enter");
  if (chooseClass) {
    const classPicker = page.getByTestId("class-picker-popover");
    await classPicker.waitFor({ timeout: 10_000 });
    // Mask 工具的 Enter 在 capture 阶段用于提交像素稿，类别弹层打开后
    // 直接点选默认类，避免第二个 Enter 再次被 Mask 编辑器拦截。
    await classPicker.getByText("car", { exact: true }).click();
  }
  await page.getByTestId("mask-toolbar").waitFor({ state: "hidden", timeout: 15_000 });
}

export async function runVideoMaskTrackEdit(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15_000 });
  await page.getByTestId("video-konva-stage").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1800);

  const surface = page.getByTestId("video-konva-stage");
  const box = await surface.boundingBox();
  if (!box) throw new Error("[video-mask-track-edit] video-konva-stage 没有可见边界");
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  const drawStartMs = Date.now();

  await page.getByTestId("video-tool-btn-mask-track").click();
  const toolbar = page.getByTestId("mask-toolbar");
  await toolbar.waitFor({ timeout: 10_000 });

  await stroke(page, at(0.35, 0.46), at(0.55, 0.48));
  await stroke(page, at(0.53, 0.52), at(0.37, 0.55));
  await page.waitForTimeout(650);
  await confirmMask(page, true);

  const trackRow = page.locator('[data-testid^="video-mask-track-"]').last();
  await trackRow.waitFor({ timeout: 15_000 });
  await trackRow.click();
  await page.waitForTimeout(500);

  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(180);
  }
  await page
    .getByText(/\u5f53\u524d\u5e27\u4fdd\u6301 F0 \u7684 Mask/)
    .waitFor({ timeout: 10_000 });
  await page.waitForTimeout(650);

  await page.getByTitle("编辑当前帧 Mask").click();
  await toolbar.waitFor({ timeout: 10_000 });
  await stroke(page, at(0.46, 0.43), at(0.58, 0.52));
  await page.waitForTimeout(650);
  await confirmMask(page, false);
  await page.getByText("当前帧为 Mask 关键帧。").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);

  return { drawStartMs, drawEndMs: Date.now() };
}
