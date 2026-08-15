/**
 * 流程录制：多边形(polygon / region)逐点绘制 + 闭合。
 *
 * 输出：outputs/flows/polygon-draw.gif → docs-site/.../polygon/draw-in-progress.gif
 *
 * screenshot catalog 的 image_demo 已绑定 region 工具单位（tool polygon→unit region）。选「多边形」工具 →
 * 在画布逐点单击落顶点，每段带预览线；Enter 闭合提交（geometry.type=polygon）。
 * Konva canvas，用 page.mouse 坐标逐点点击。落点刻意避开首点（靠近首点会自动闭合提前结束）。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(隐藏预测/选工具)与结尾(落库等待)。
 * 画完的多边形由 flows.spec 的 afterAll 重建截图 seed 清理。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  commitPendingAnnotationClass,
  hidePredictions,
  mediaPoint,
  openImageAnnotate,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runPolygonDraw(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  await page.waitForTimeout(1400);

  // 准备（不进 GIF）：隐藏预测 → 选多边形工具
  await hidePredictions(page);

  const btn = page.getByTestId("tool-btn-polygon");
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await renderedMediaBounds(stage);
  const anchor = recordingAnchor(catalog, "image_demo", "annotating", "primary_vehicle");
  if (anchor.polygon.length < 3) {
    throw new Error("[polygon-draw] primary_vehicle 缺少可闭合轮廓锚点");
  }
  const points = anchor.polygon.map((point) => mediaPoint(box, point));

  const drawStartMs = Date.now();

  // ── 沿复核轮廓逐点落顶点，点间停顿让录屏看到预览线；末点离首点足够远不触发自动闭合 ──
  for (const { x, y } of points) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    await page.mouse.click(x, y);
    await page.waitForTimeout(480);
  }
  // 悬停展示回到首点的闭合预览线
  await page.mouse.move(points[0].x, points[0].y);
  await page.waitForTimeout(800);
  // Enter 闭合多边形并提交
  await page.keyboard.press("Enter");
  await commitPendingAnnotationClass(page, {
    label: anchor.label,
    taskId: catalog.projects.image_demo.tasks.annotating.id,
  });
  await page.waitForTimeout(1400);

  const drawEndMs = Date.now();

  // 等 autosave 把多边形落库（清理由 flows.spec 的 afterAll 重建截图 seed 完成）
  await page.waitForTimeout(1200);

  return { drawStartMs, drawEndMs };
}
