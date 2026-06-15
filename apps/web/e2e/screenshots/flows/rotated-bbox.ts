/**
 * 流程录制：旋转框(OBB)绘制 + 旋转。
 *
 * 输出：outputs/flows/rotated-bbox.gif → docs-site/.../workbench/rotated-bbox.gif
 *
 * P-COCO8 已绑定 rotated_bbox 工具单位（seed_coco8.py）。选「旋转框」工具 → 在画布拖出
 * 轴对齐矩形（提交 angle=0 的 rotated_bbox）→ 抓顶边外侧旋转手柄拖动改 angle。
 * 画布是 Konva canvas，手柄无 DOM 句柄，全程用 page.mouse 坐标操作。
 *
 * 返回 { drawStartMs, drawEndMs }：绘制段的起止时间戳，供 finalize 裁掉开头(隐藏预测)
 * 与结尾(落库等待)，GIF 只保留绘制过程。画完的标注由 flows.spec 的 afterAll 经 psql 清理。
 */
import type { Page } from "@playwright/test";
import type { SeedData } from "../../fixtures/seed";
import { hidePredictions } from "./_canvas";

export interface DrawWindow {
  drawStartMs: number;
  drawEndMs: number;
}

export async function runRotatedBbox(page: Page, data: SeedData): Promise<DrawWindow | null> {
  const task = data.task_ids[0] ? `?task=${data.task_ids[0]}` : "";
  await page.goto(`/projects/${data.project_id}/annotate${task}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1400);

  // 准备（不进 GIF）：隐藏满屏预测框 → 选旋转框工具
  await hidePredictions(page);

  const btn = page.getByTestId("tool-btn-rotated-box");
  if (!(await btn.count())) {
    console.warn("[rotated-bbox] 无 tool-btn-rotated-box（项目未绑定 rotated_bbox?），跳过");
    return null;
  }
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) {
    console.warn("[rotated-bbox] 无 workbench-stage 边界，跳过");
    return null;
  }
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

  // 注：旋转手柄是 Konva 绘制无 DOM 句柄，盲拖坐标易在 rotated-box 工具下空拖出第二个框，
  // 故本 GIF 只演示「绘制」；旋转演示留待后续(需精确手柄坐标或 DOM 句柄)。

  const drawEndMs = Date.now();

  // 等 autosave 把新框落库（清理由 flows.spec 的 afterAll 经 psql 完成）
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  return { drawStartMs, drawEndMs };
}
