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
import { hidePredictions, openImageAnnotate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runPolygonDraw(page: Page, catalog: ScreenshotSeedCatalog): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  await page.waitForTimeout(1400);

  // 准备（不进 GIF）：隐藏预测 → 选多边形工具
  await hidePredictions(page);

  const btn = page.getByTestId("tool-btn-polygon");
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("[polygon-draw] workbench-stage 没有可见边界");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const drawStartMs = Date.now();

  // ── 逐点落顶点（五边形），点间停顿让录屏看到预览线；末点离首点足够远不触发自动闭合 ──
  const pts: Array<[number, number]> = [
    [cx - 150, cy - 70],
    [cx + 60, cy - 110],
    [cx + 170, cy + 30],
    [cx + 40, cy + 130],
    [cx - 140, cy + 80],
  ];
  for (const [x, y] of pts) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(320);
    await page.mouse.click(x, y);
    await page.waitForTimeout(520);
  }
  // 悬停展示回到首点的闭合预览线
  await page.mouse.move(cx - 150, cy - 70);
  await page.waitForTimeout(800);
  // Enter 闭合多边形并提交
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1100);

  const drawEndMs = Date.now();

  // 等 autosave 把多边形落库（清理由 flows.spec 的 afterAll 重建截图 seed 完成）
  await page.waitForTimeout(1200);

  return { drawStartMs, drawEndMs };
}
