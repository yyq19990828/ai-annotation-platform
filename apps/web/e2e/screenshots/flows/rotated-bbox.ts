/**
 * 流程录制：旋转框(OBB)绘制 + 旋转。
 *
 * 输出：outputs/flows/rotated-bbox.gif → docs-site/.../workbench/rotated-bbox.gif
 *
 * screenshot catalog 的 image_demo 已绑定 rotated_bbox 工具单位。选「旋转框」工具 → 在画布拖出
 * 轴对齐矩形（提交 angle=0 的 rotated_bbox）→ 抓顶边外侧旋转手柄拖动改 angle。
 * 画布是 Konva canvas，手柄无 DOM 句柄，全程用 page.mouse 坐标操作。
 *
 * 返回 { drawStartMs, drawEndMs }：绘制段的起止时间戳，供 finalize 裁掉开头(隐藏预测)
 * 与结尾(落库等待)，GIF 只保留绘制过程。画完的标注由 flows.spec 的 afterAll 重建截图 seed 清理。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { hidePredictions, openImageAnnotate } from "./_canvas";

export interface DrawWindow {
  drawStartMs: number;
  drawEndMs: number;
}

export async function runRotatedBbox(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  await page.waitForTimeout(1400);

  // 准备（不进 GIF）：隐藏满屏预测框 → 选旋转框工具
  await hidePredictions(page);

  const btn = page.getByTestId("tool-btn-rotated-box");
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("[rotated-bbox] workbench-stage 没有可见边界");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const halfW = 130;
  const halfH = 80;

  const drawStartMs = Date.now();

  // ── 拖出一个轴对齐矩形（左上 → 右下，分步移动让录屏看到拉框过程）──
  await page.mouse.move(cx - halfW, cy - halfH);
  await page.waitForTimeout(400);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx - halfW + (2 * halfW * i) / 12, cy - halfH + (2 * halfH * i) / 12);
    await page.waitForTimeout(55);
  }
  await page.mouse.up();
  await page.waitForTimeout(1400); // 停留展示画好的旋转框(angle=0)被选中态 + 手柄

  // ── 抓旋转手柄改 angle ──
  // 手柄是 Konva Circle，无 DOM 句柄，但屏幕坐标可精确推算：它在框中心正上方
  // halfH + handleOffset 处（ImageStageShapes：handleY = -hh - 18/scale；18/scale 经
  // scale 补偿后恒为 18 屏幕 px，故与缩放无关）。命中圈带 hitStrokeWidth 容差，盲拖风险已消除。
  // 旋转角算法（ImageStage rotateBox）：deg = atan2(dx, -dy)，正上方为 0°、顺时针为正；
  // 故让光标保持半径 r 绕框中心 (cx,cy) 顺时针扫角，即可把 angle 从 0 拖到 targetDeg。
  const handleOffset = 18;
  const r = halfH + handleOffset;
  await page.mouse.move(cx, cy - r); // 命中正上方手柄
  await page.waitForTimeout(450);
  await page.mouse.down();
  await page.waitForTimeout(200);
  const targetDeg = 35;
  const rotSteps = 14;
  for (let i = 1; i <= rotSteps; i++) {
    const rad = ((targetDeg * i) / rotSteps) * (Math.PI / 180);
    await page.mouse.move(cx + r * Math.sin(rad), cy - r * Math.cos(rad));
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(700); // 停留展示旋转到位的框
  await page.mouse.up();
  await page.waitForTimeout(1000); // 等 commit 落库 + 选中态稳定

  const drawEndMs = Date.now();

  // 等 autosave 把新框落库（清理由 flows.spec 的 afterAll 重建截图 seed 完成）
  await page.waitForTimeout(1200);

  return { drawStartMs, drawEndMs };
}
