/**
 * M3 · 流程录制：审核拒回（进审核台 → 查看标注 → 拒回 → 填写原因 → 确认）。
 *
 * 输出：outputs/flows/review-reject.gif
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";

export async function runReviewReject(page: Page, catalog: ScreenshotSeedCatalog): Promise<void> {
  // ── Step 1：进入审核工作台 ───────────────────────────────────
  const project = catalog.projects.image_demo;
  await page.goto(
    `/projects/${project.id}/review?batch=${project.batches.review.id}` +
      `&task=${project.tasks.review.id}&returnTo=%2Freview`,
  );
  await page.getByTestId("review-reject").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1000);

  // ── Step 2：查看标注内容（停留让录屏捕捉）────────────────────
  await page.waitForTimeout(1500);

  // ── Step 3：点击拒回按钮 ─────────────────────────────────────
  const rejectBtn = page.getByTestId("review-reject");
  await rejectBtn.click();
  await page.waitForTimeout(500);

  // ── Step 4：等待对话框出现，填写原因 ─────────────────────────
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await dialog.getByRole("textbox").fill("标注框偏移，请重新对齐目标边缘（演示）");
  await page.waitForTimeout(800);
  await dialog.getByRole("button", { name: /确认|提交|拒回/ }).click();
  await page.waitForTimeout(1000);
}
