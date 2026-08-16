/**
 * 流程录制：轴对齐 Bbox（矩形）绘制。
 *
 * 输出：outputs/flows/bbox-draw.gif → docs-site/.../bbox/draw-in-progress.gif
 *
 * screenshot catalog 的 image_demo 内置 bbox 工具单位。选「矩形」工具(id=box) → 在画布按下拖动松开
 * 生成一个矩形（geometry.type=bbox）→ 选中态展示 8 个控制手柄（4 角 + 4 边）。
 * 画布是 Konva canvas，手柄无 DOM 句柄，全程用 page.mouse 坐标操作。
 *
 * 项目和任务由 screenshot catalog 的 image_demo.annotating 稳定定位。
 *
 * 返回 { drawStartMs, drawEndMs }：绘制段起止时间戳，供 finalize 裁掉开头(隐藏预测/选工具)
 * 与结尾(落库等待)，GIF 只保留绘制过程。画完的标注由 flows.spec 的 afterAll 重建截图 seed 清理。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  hidePredictions,
  commitPendingAnnotationClass,
  mediaBbox,
  movePointerAtRefreshRate,
  openImageAnnotate,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runBboxDraw(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  options: { marketing?: boolean } = {},
): Promise<DrawWindow> {
  const taskKey = "annotating";
  const task = catalog.projects.image_demo.tasks[taskKey];
  if (!task) throw new Error(`[bbox-draw] image_demo 缺少任务 ${taskKey}`);
  const hold = (normalMs: number, marketingMs: number) =>
    page.waitForTimeout(options.marketing ? marketingMs : normalMs);

  await openImageAnnotate(page, catalog, taskKey);
  await expect(page.getByTestId("workbench-stage")).toHaveAttribute("data-image-ready", "true", {
    timeout: 10_000,
  });
  await hold(1_400, 900);

  // 准备（不进 GIF）：隐藏满屏预测框 → 选矩形工具
  await hidePredictions(page);
  await hold(0, 250);

  const btn = page.getByTestId("tool-btn-box");
  await btn.click();
  await hold(900, 500);

  const stage = page.getByTestId("workbench-stage");
  const box = await renderedMediaBounds(stage);
  const anchor = recordingAnchor(catalog, "image_demo", taskKey, "primary_vehicle");
  const { start, end } = mediaBbox(box, anchor.bbox);

  const drawStartMs = Date.now();

  // ── 拖出一个矩形（左上 → 右下，分步移动让录屏看到拉框过程）──
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(options.marketing ? 200 : 400);
  await page.mouse.down();
  await expect(stage).toHaveAttribute("data-drag-kind", "draw", { timeout: 2_000 });
  if (options.marketing) {
    await movePointerAtRefreshRate(page, start, end, 650);
  } else {
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * i) / steps,
        start.y + ((end.y - start.y) * i) / steps,
      );
      await page.waitForTimeout(55);
    }
  }
  await expect(stage).toHaveAttribute("data-drag-changed", "true", { timeout: 2_000 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-pending-drawing", "true", { timeout: 2_000 });
  const classPicker = page.getByTestId("class-picker-popover");
  await classPicker.waitFor({ state: "visible", timeout: 5_000 });
  await hold(0, 450);
  await commitPendingAnnotationClass(page, { label: anchor.label, taskId: task.id });
  await hold(1_600, 2_200); // 短暂展示已保存的矩形和 8 个控制手柄

  const drawEndMs = Date.now();

  // 等 autosave 把新框落库（清理由 flows.spec 的 afterAll 重建截图 seed 完成）
  await hold(1_200, 0);

  return { drawStartMs, drawEndMs };
}
