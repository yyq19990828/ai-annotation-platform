/**
 * 流程录制：从空白创建视频 Mask 轨迹，再在后续帧物化新关键帧。
 *
 * Mask 轨迹属于轨迹工具组，不使用单帧 Mask 的 M 快捷键。流程会落库，
 * 由 flows.spec 的 afterAll 重建 screenshots seed 清理。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { mediaPoint, recordingAnchor } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

async function stroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function confirmMask(page: Page, chooseClass: boolean) {
  const toolbar = page.getByTestId("mask-toolbar");
  const confirm = toolbar.getByTitle("确认 (Enter)");
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  if (chooseClass) {
    const classPicker = page.getByTestId("class-picker-popover");
    await classPicker.waitFor({ timeout: 10_000 });
    // 直接点选默认类，避免类别弹层的键盘焦点影响 Mask 提交流程。
    await classPicker.getByText("car", { exact: true }).click();
  }
  await toolbar.waitFor({ state: "hidden", timeout: 15_000 });
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
  const initialAnchor = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f0", 0);
  const editAnchor = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f5", 5);
  if (initialAnchor.brush_strokes.length === 0 || editAnchor.brush_strokes.length === 0) {
    throw new Error("[video-mask-track-edit] 车辆关键帧缺少 Mask 笔刷锚点");
  }

  const drawStartMs = Date.now();

  await page.getByTestId("video-tool-btn-mask-track").click();
  const toolbar = page.getByTestId("mask-toolbar");
  await toolbar.waitFor({ timeout: 10_000 });

  for (const path of initialAnchor.brush_strokes) {
    const [from, to] = path;
    if (!from || !to) throw new Error("[video-mask-track-edit] 初始笔刷轨迹至少需要两个点");
    await stroke(page, mediaPoint(box, from), mediaPoint(box, to));
  }
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
  await toolbar.getByTitle("橡皮 (E)").click();
  for (const path of editAnchor.brush_strokes) {
    const [from, to] = path;
    if (!from || !to) throw new Error("[video-mask-track-edit] 修正笔刷轨迹至少需要两个点");
    await stroke(page, mediaPoint(box, from), mediaPoint(box, to));
  }
  await page.waitForTimeout(650);
  await confirmMask(page, false);
  await page.getByText("当前帧为 Mask 关键帧。").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);

  return { drawStartMs, drawEndMs: Date.now() };
}
