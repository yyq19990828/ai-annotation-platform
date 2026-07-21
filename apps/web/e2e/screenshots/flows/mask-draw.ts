/**
 * 流程录制：Mask 笔刷涂抹 + 提交。
 *
 * 输出：outputs/flows/mask-draw.gif → docs-site/.../mask-brush/draw-in-progress.gif
 *
 * screenshot catalog 的 image_demo 已绑定 region 工具单位，Mask 笔刷归属 region。选「Mask 笔刷」工具 →
 * 按住左键拖动涂抹（pointerdown 起笔，pointermove 连续涂），来回几笔填出一块区域 → Enter 提交。
 * 提交类型由任务 Mask 能力决定：原生项目落 raster_mask，兼容项目落 polygon。
 * Konva canvas，用 page.mouse 坐标拖动。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(隐藏预测/选工具)与结尾(落库等待)。
 * 画完的 mask 由 flows.spec 的 afterAll 重建截图 seed 清理。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { hidePredictions, openImageAnnotate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

/** 沿水平线从 x0 涂到 x1（分步移动让录屏看到连续笔迹）。 */
async function stroke(page: Page, x0: number, x1: number, y: number) {
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

export async function runMaskDraw(page: Page, catalog: ScreenshotSeedCatalog): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  await page.waitForTimeout(1400);

  // 准备（不进 GIF）：隐藏预测 → 选 Mask 笔刷
  await hidePredictions(page);

  const btn = page.getByTestId("tool-btn-mask");
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("[mask-draw] workbench-stage 没有可见边界");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const drawStartMs = Date.now();

  // ── 来回几笔填出一块区域（默认笔刷半径），逐行下移 ──
  await stroke(page, cx - 120, cx + 120, cy - 40);
  await stroke(page, cx + 120, cx - 120, cy - 10);
  await stroke(page, cx - 120, cx + 120, cy + 20);
  await stroke(page, cx + 100, cx - 100, cy + 50);
  await page.waitForTimeout(700); // 停留展示涂好的色块

  // Enter 提交 Mask（实际落库类型由任务能力决定）
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1100);

  const drawEndMs = Date.now();

  // 等 autosave 落库（清理由 flows.spec 的 afterAll 重建截图 seed 完成）
  await page.waitForTimeout(1200);

  return { drawStartMs, drawEndMs };
}
