/**
 * canvas 流程录制共享工具。
 */
import type { Page } from "@playwright/test";

/**
 * 隐藏所有预测来源（取消 AI 面板「预测来源筛选」里仍勾选且可点的来源）。
 *
 * COCO8 任务满屏 external_import 预测框，绘制工具的指针手势会落在预测框上触发
 * 「采纳/驳回」浮层而画不出新形状；先把预测隐藏，画布干净后再绘制。
 */
export async function hidePredictions(page: Page): Promise<void> {
  const card = page.locator('[aria-label="预测来源筛选"]');
  await card.waitFor({ timeout: 4000 }).catch(() => {});
  if (!(await card.count())) return;
  // 逐个取消勾选（每次取消后 :checked 集合变化，始终取第一个仍勾选且未禁用的）
  for (let i = 0; i < 4; i++) {
    const checkbox = card.locator('input[type="checkbox"]:checked:not([disabled])').first();
    if (!(await checkbox.count())) break;
    await checkbox.click().catch(() => {});
    await page.waitForTimeout(350);
  }
}

/**
 * 清掉刚画的标注（Ctrl+A 全选当前帧 user 框 → Delete），避免演示标注落库污染。
 * 在录屏裁剪窗口之后调用，删除动作不会进 GIF。
 */
export async function deleteDrawn(page: Page): Promise<void> {
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(300);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
}
