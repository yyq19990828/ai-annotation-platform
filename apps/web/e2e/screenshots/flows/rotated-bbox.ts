/**
 * 流程录制：旋转框(OBB)绘制 + 旋转。
 *
 * 输出：outputs/flows/rotated-bbox.gif → docs-site/.../workbench/rotated-bbox.gif
 *
 * P-COCO8 已绑定 rotated_bbox 工具单位（seed_coco8.py）。选「旋转框」工具 → 在画布拖出
 * 轴对齐矩形（提交 angle=0 的 rotated_bbox）→ 抓顶边外侧旋转手柄拖动改 angle。
 * 画布是 Konva canvas，手柄无 DOM 句柄，全程用 page.mouse 坐标操作。
 */
import type { Page } from "@playwright/test";
import type { SeedData } from "../../fixtures/seed";

export async function runRotatedBbox(page: Page, data: SeedData): Promise<void> {
  const task = data.task_ids[0] ? `?task=${data.task_ids[0]}` : "";
  await page.goto(`/projects/${data.project_id}/annotate${task}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1600);

  // 选「旋转框」工具
  const btn = page.getByTestId("tool-btn-rotated-box");
  if (!(await btn.count())) {
    console.warn("[rotated-bbox] 无 tool-btn-rotated-box（项目未绑定 rotated_bbox?），跳过");
    return;
  }
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) {
    console.warn("[rotated-bbox] 无 workbench-stage 边界，跳过");
    return;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const halfW = 130;
  const halfH = 80;

  // ── Step 1：拖出一个轴对齐矩形（左上 → 右下，分步移动让录屏看到拉框过程）──
  await page.mouse.move(cx - halfW, cy - halfH);
  await page.waitForTimeout(500);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx - halfW + (2 * halfW * i) / 12, cy - halfH + (2 * halfH * i) / 12);
    await page.waitForTimeout(55);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);

  // ── Step 2：抓顶边中点外侧的旋转手柄，左右拖动旋转 ~30° ──
  const handleX = cx;
  const handleY = cy - halfH - 26; // 顶边外侧
  await page.mouse.move(handleX, handleY);
  await page.waitForTimeout(500);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(handleX + (95 * i) / 14, handleY + (40 * i) / 14);
    await page.waitForTimeout(70);
  }
  await page.mouse.up();
  await page.waitForTimeout(1600);
}
