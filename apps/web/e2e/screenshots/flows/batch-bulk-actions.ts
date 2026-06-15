/**
 * 流程录制：批次多选 → 批量操作工具栏浮现（含批量通过/驳回）。
 *
 * 输出：outputs/flows/batch-bulk-actions.gif → docs-site/.../projects/batch-bulk-actions.gif
 *
 * P-0001（2D图片标注测试）有 BT-260/261/262 多批次，勾选后 BatchesSection 浮出
 * 「已选 N 个批次」工具栏（激活/通过/驳回/改派/归档/删除）。
 */
import type { Page } from "@playwright/test";

const P0001 = "3f999396-65da-4f2b-a32d-d1560bad74b0";

export async function runBatchBulkActions(page: Page): Promise<void> {
  // ── Step 1：进项目设置「批次管理」────────────────────────────
  await page.goto(`/projects/${P0001}/settings?section=batches`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);

  // ── Step 2：确保列表视图（行 checkbox 在列表态）──────────────
  const listTab = page.getByRole("button", { name: /^列表$|列表/ }).first();
  if (await listTab.count()) {
    await listTab.click().catch(() => {});
    await page.waitForTimeout(700);
  }

  // ── Step 3：逐行勾选 → 批量工具栏浮现（停顿让录屏捕捉）───────
  const checkboxes = page.locator('tbody input[type="checkbox"]');
  const n = await checkboxes.count();
  for (let i = 0; i < Math.min(2, n); i++) {
    await checkboxes.nth(i).click().catch(() => {});
    await page.waitForTimeout(800);
  }

  // ── Step 4：停留展示「已选 … 通过/驳回/改派/归档/删除」─────
  await page
    .getByText(/已选/)
    .first()
    .waitFor({ timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
}
