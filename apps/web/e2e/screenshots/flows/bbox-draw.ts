/**
 * 流程录制：轴对齐 Bbox（矩形）绘制。
 *
 * 输出：outputs/flows/bbox-draw.gif → docs-site/.../bbox/draw-in-progress.gif
 *
 * P-COCO8 内置 bbox 工具单位（seed_coco8.py）。选「矩形」工具(id=box) → 在画布按下拖动松开
 * 生成一个矩形（geometry.type=bbox）→ 选中态展示 8 个控制手柄（4 角 + 4 边）。
 * 画布是 Konva canvas，手柄无 DOM 句柄，全程用 page.mouse 坐标操作。
 *
 * 不走 seed/peek（它当前可能返回视频项目 P-VIDEO-DEV，进的是视频工作台没有 tool-btn-box），
 * 改用 admin token 按 display_id='P-COCO8' 解析图片项目 + 首个 task，与视频/点云 flow 同思路。
 *
 * 返回 { drawStartMs, drawEndMs }：绘制段起止时间戳，供 finalize 裁掉开头(隐藏预测/选工具)
 * 与结尾(落库等待)，GIF 只保留绘制过程。画完的标注由 flows.spec 的 afterAll 经 psql 清理。
 */
import type { Page } from "@playwright/test";
import { hidePredictions, openCoco8Annotate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runBboxDraw(page: Page, adminEmail: string): Promise<DrawWindow | null> {
  if (!(await openCoco8Annotate(page, adminEmail))) {
    console.warn("[bbox-draw] 无法解析 P-COCO8（seed_coco8 未跑?），跳过");
    return null;
  }
  await page.waitForTimeout(1400);

  // 准备（不进 GIF）：隐藏满屏预测框 → 选矩形工具
  await hidePredictions(page);

  const btn = page.getByTestId("tool-btn-box");
  if (!(await btn.count())) {
    console.warn("[bbox-draw] 无 tool-btn-box（项目未绑定 bbox?），跳过");
    return null;
  }
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) {
    console.warn("[bbox-draw] 无 workbench-stage 边界，跳过");
    return null;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const halfW = 130;
  const halfH = 85;

  const drawStartMs = Date.now();

  // ── 拖出一个矩形（左上 → 右下，分步移动让录屏看到拉框过程）──
  await page.mouse.move(cx - halfW, cy - halfH);
  await page.waitForTimeout(400);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx - halfW + (2 * halfW * i) / 12, cy - halfH + (2 * halfH * i) / 12);
    await page.waitForTimeout(55);
  }
  await page.mouse.up();
  await page.waitForTimeout(1600); // 停留展示画好的矩形被选中态 + 8 个控制手柄

  const drawEndMs = Date.now();

  // 等 autosave 把新框落库（清理由 flows.spec 的 afterAll 经 psql 完成）
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  return { drawStartMs, drawEndMs };
}
