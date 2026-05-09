/**
 * M3 · 流程录制：AI 预标注（选项目 → 配置 backend → 发起预标注 → 查看结果）。
 *
 * 输出：outputs/flows/ai-preannotate.gif
 */
import type { Page } from "@playwright/test";
import type { SeedData } from "../../fixtures/seed";

export async function runAiPreannotate(page: Page, data: SeedData): Promise<void> {
  // ── Step 1：进入 AI 预标注入口 ───────────────────────────────
  await page.goto("/ai-pre");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  // ── Step 2：选择项目 ─────────────────────────────────────────
  const projectSelect = page.getByTestId("ai-pre-project-select");
  if (await projectSelect.count() && data.project_id) {
    await projectSelect.click();
    await page.waitForTimeout(300);
    // 选择第一个选项
    const firstOption = page.getByRole("option").first();
    if (await firstOption.count()) {
      await firstOption.click();
      await page.waitForTimeout(500);
    }
  }

  // ── Step 3：选择批次 ─────────────────────────────────────────
  const batchSelect = page.getByTestId("ai-pre-batch-select");
  if (await batchSelect.count()) {
    await batchSelect.click();
    await page.waitForTimeout(300);
    const firstBatch = page.getByRole("option").first();
    if (await firstBatch.count()) {
      await firstBatch.click();
      await page.waitForTimeout(500);
    }
  }

  // ── Step 4：点击发起预标注 ───────────────────────────────────
  const startBtn = page.getByTestId("ai-pre-start");
  if (await startBtn.count()) {
    await startBtn.click();
    await page.waitForTimeout(1500);
  }

  // ── Step 5：查看历史列表 ─────────────────────────────────────
  const historyTab = page.getByTestId("ai-pre-history-tab");
  if (await historyTab.count()) {
    await historyTab.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
  }
}
