/**
 * canvas 流程录制共享工具。
 */
import type { Page } from "@playwright/test";

/**
 * 监听 workbench 对 /tasks/{id}/annotations 的请求，拿到实际打开的任务 id。
 * peek.task_id 未必属于 COCO8，workbench 会忽略 ?task= 改开本项目首个任务，
 * 且不把真实 task 同步回 URL，故只能从网络请求里抓。返回一个读取最新 id 的 getter。
 */
export function trackTaskId(page: Page): () => string | null {
  let id: string | null = null;
  page.on("request", (req) => {
    const m = req.url().match(/\/tasks\/([0-9a-fA-F-]{36})\/annotations/);
    if (m) id = m[1];
  });
  return () => id;
}

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