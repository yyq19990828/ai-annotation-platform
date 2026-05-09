/**
 * M3 · 流程录制：审核拒回（进审核台 → 查看标注 → 拒回 → 填写原因 → 确认）。
 *
 * 输出：outputs/flows/review-reject.gif
 */
import type { Page } from "@playwright/test";
import type { SeedData } from "../../fixtures/seed";

export async function runReviewReject(page: Page, data: SeedData): Promise<void> {
  if (!data.task_ids[0]) {
    console.warn("[review-reject] 无任务数据，跳过流程");
    return;
  }

  // ── Step 1：进入审核工作台 ───────────────────────────────────
  await page.goto(`/review?task=${data.task_ids[0]}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // ── Step 2：查看标注内容（停留让录屏捕捉）────────────────────
  await page.waitForTimeout(1500);

  // ── Step 3：点击拒回按钮 ─────────────────────────────────────
  const rejectBtn = page.getByTestId("review-reject");
  if (await rejectBtn.count()) {
    await rejectBtn.click();
    await page.waitForTimeout(500);
  } else {
    console.warn("[review-reject] 未找到 review-reject 按钮，跳过");
    return;
  }

  // ── Step 4：等待对话框出现，填写原因 ─────────────────────────
  const dialog = page.getByTestId("reject-dialog");
  if (await dialog.count()) {
    await page.waitForTimeout(300);
    const textarea = dialog.getByRole("textbox");
    if (await textarea.count()) {
      await textarea.fill("标注框偏移，请重新对齐目标边缘（演示）");
      await page.waitForTimeout(800);
    }

    // ── Step 5：确认拒回 ─────────────────────────────────────
    const confirmBtn = dialog.getByRole("button", { name: /确认|提交|拒回/ });
    if (await confirmBtn.count()) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
    }
  }
}
