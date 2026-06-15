/**
 * 流程录制：折线(polyline)逐点绘制。
 *
 * 输出：outputs/flows/polyline-draw.gif → docs-site/.../polyline/draw-in-progress.gif
 *
 * P-COCO8 已绑定 polyline 工具单位（seed_coco8.py）。选「折线」工具 → 在画布逐点单击落顶点，
 * 每段带预览线；Enter 结束（不闭合）。Konva canvas，用 page.mouse 坐标逐点点击。
 */
import type { Page } from "@playwright/test";
import type { SeedData } from "../../fixtures/seed";
import { hidePredictions } from "./_canvas";

export async function runPolylineDraw(page: Page, data: SeedData): Promise<void> {
  const task = data.task_ids[0] ? `?task=${data.task_ids[0]}` : "";
  await page.goto(`/projects/${data.project_id}/annotate${task}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1400);

  // 关掉预测来源可见性，画布干净后再逐点落折线（同 rotated-bbox）
  await hidePredictions(page);

  // 选「折线」工具
  const btn = page.getByTestId("tool-btn-polyline");
  if (!(await btn.count())) {
    console.warn("[polyline-draw] 无 tool-btn-polyline（项目未绑定 polyline?），跳过");
    return;
  }
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) {
    console.warn("[polyline-draw] 无 workbench-stage 边界，跳过");
    return;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // ── 逐点落顶点（折线状），每点之间停顿让录屏看到预览线 ──
  const pts: Array<[number, number]> = [
    [cx - 160, cy + 60],
    [cx - 70, cy - 50],
    [cx + 20, cy + 40],
    [cx + 110, cy - 60],
    [cx + 190, cy + 20],
  ];
  for (const [x, y] of pts) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(350);
    await page.mouse.click(x, y);
    await page.waitForTimeout(550);
  }
  // 悬停展示最后一段预览线
  await page.mouse.move(cx + 240, cy - 30);
  await page.waitForTimeout(900);
  // Enter 结束折线（不闭合）
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1400);
}
