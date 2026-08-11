/**
 * M3 · 流程录制：审核退回（进质检工作台 → 定位待审任务 → 退回 → 填写原因 → 确认）。
 *
 * 输出：outputs/flows/review-reject.gif
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";

export async function runReviewReject(page: Page, catalog: ScreenshotSeedCatalog): Promise<void> {
  // ── Step 1：进入质检工作台，定位固定待审任务 ──────────
  const project = catalog.projects.image_demo;
  await page.goto("/dashboard");
  await page.getByRole("heading", { name: "质检工作台" }).waitFor({ timeout: 10_000 });
  const taskRow = page
    .getByText(project.tasks.review.display_id, { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="退回"]][1]');
  await taskRow.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1000);

  // ── Step 2：点击该任务的退回按钮 ────────────────
  await taskRow.getByRole("button", { name: "退回" }).click();
  await page.waitForTimeout(500);

  // ── Step 3：选择结构化原因并填写补充说明 ─────────────
  const dialog = page.getByRole("dialog", { name: /退回原因/ });
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await dialog.getByTestId("reject-type-wrong_geometry").click();
  await dialog.getByTestId("reject-comment").fill("标注框偏移，请重新对齐目标边缘（演示）");
  await page.waitForTimeout(800);
  await dialog.getByTestId("reject-confirm").click();
  await page.waitForTimeout(1000);
}
