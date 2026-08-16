/**
 * 流程录制：从空白创建视频 Mask 轨迹，再在后续帧物化新关键帧。
 *
 * Mask 轨迹属于轨迹工具组，不使用单帧 Mask 的 M 快捷键。流程会落库，
 * 由 flows.spec 的 afterAll 重建 screenshots seed 清理。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  commitPendingAnnotationClass,
  mediaPoint,
  movePointerPathAtRefreshRate,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

async function stroke(page: Page, points: Array<{ x: number; y: number }>, durationMs: number) {
  const first = points[0];
  if (!first || points.length < 2) {
    throw new Error("[video-mask-track-edit] 笔刷路径至少需要两个点");
  }
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await movePointerPathAtRefreshRate(page, points, durationMs);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function confirmMask(
  page: Page,
  options: { label?: string; taskId: number; update?: boolean },
) {
  const toolbar = page.getByTestId("mask-toolbar");
  const confirm = toolbar.getByTitle("确认 (Enter)");
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  const updated = options.update
    ? page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          /\/video\/tracks\/[^/]+\/mask-keyframes\/\d+(?:\?|$)/.test(response.url()) &&
          response.ok(),
        { timeout: 20_000 },
      )
    : null;
  await confirm.click();
  if (options.label) {
    await commitPendingAnnotationClass(page, {
      label: options.label,
      taskId: options.taskId,
    });
  }
  if (updated) await updated;
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
  const box = await renderedMediaBounds(surface);
  const initialAnchor = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f0", 0);
  const editAnchor = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f5", 5);
  if (initialAnchor.brush_strokes.length === 0 || editAnchor.brush_strokes.length === 0) {
    throw new Error("[video-mask-track-edit] 车辆关键帧缺少 Mask 笔刷锚点");
  }

  const drawStartMs = Date.now();

  await page.getByTestId("video-tool-btn-mask-track").click();
  const toolbar = page.getByTestId("mask-toolbar");
  await toolbar.waitFor({ timeout: 10_000 });

  // 六条横线合并成一条来回往返的连续笔迹：画面仍呈现逐行覆盖，
  // 但只触发一次 pointerdown/up，避免 4K Mask 每笔全量重绘把操作拉长。
  const initialPath = initialAnchor.brush_strokes.flatMap((path, index) => {
    const points = path.map((point) => mediaPoint(box, point));
    return index % 2 === 0 ? points : points.reverse();
  });
  await stroke(page, initialPath, 1_800);
  await page.waitForTimeout(650);
  await confirmMask(page, {
    label: initialAnchor.label,
    taskId: project.tasks.tracking.id,
  });

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
    await stroke(
      page,
      path.map((point) => mediaPoint(box, point)),
      600,
    );
  }
  await page.waitForTimeout(650);
  await confirmMask(page, { taskId: project.tasks.tracking.id, update: true });
  await page.getByText("当前帧为 Mask 关键帧。").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
  // 在两个真实关键帧间往返，验证 F0 初始 Mask 与 F5 人工修订都已落入同一轨迹。
  await page.getByRole("button", { name: "上一关键帧" }).click();
  await page.getByTestId("video-konva-stage").waitFor({ state: "visible" });
  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "下一关键帧" }).click();
  await page.waitForTimeout(1_200);

  return { drawStartMs, drawEndMs: Date.now() };
}
