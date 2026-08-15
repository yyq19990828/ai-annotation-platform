/**
 * M3 · 流程录制：审核退回（进质检工作台 → 定位待审任务 → 退回 → 填写原因 → 确认）。
 *
 * 输出：outputs/flows/review-reject.gif
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runReviewReject(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  // ── Step 1：进入质检工作台，定位固定待审任务 ──────────
  const project = catalog.projects.image_demo;
  await page.goto("/dashboard");
  await page.getByRole("heading", { name: "质检工作台" }).waitFor({ timeout: 10_000 });
  const taskRow = page
    .getByText(project.tasks.review.display_id, { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="退回"]][1]');
  await taskRow.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1000);
  const drawStartMs = Date.now();

  // ── Step 2：点击该任务的退回按钮 ────────────────
  await taskRow.getByRole("button", { name: "退回" }).click();
  await page.waitForTimeout(500);

  // ── Step 3：选择结构化原因并填写补充说明 ─────────────
  const dialog = page.getByRole("dialog", { name: /退回原因/ });
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await dialog.getByTestId("reject-type-wrong_geometry").click();
  await page.waitForTimeout(500);
  await dialog
    .getByTestId("reject-comment")
    .pressSequentially("标注框偏移，请重新对齐目标边缘（演示）", { delay: 55 });
  await page.waitForTimeout(1000);
  await dialog.getByTestId("reject-confirm").click();
  await page.getByText("任务已退回标注员", { exact: true }).waitFor({ timeout: 10_000 });
  // 被退回任务仍会出现在“我的最近审核记录”，只应从待审核列表移除。
  const pendingList = page
    .getByRole("heading", { name: /待审核任务/ })
    .locator("xpath=../following-sibling::div[1]");
  await page.waitForFunction(
    ({ displayId }) => {
      const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find((node) =>
        node.textContent?.includes("待审核任务"),
      );
      const list = heading?.parentElement?.nextElementSibling;
      return !list?.textContent?.includes(displayId);
    },
    { displayId: project.tasks.review.display_id },
    { timeout: 10_000 },
  );
  await pendingList.waitFor({ state: "visible", timeout: 10_000 });
  const recentRecord = page.getByText(project.tasks.review.display_id, { exact: true }).last();
  await recentRecord.scrollIntoViewIfNeeded();
  await recentRecord.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(4_000);
  return { drawStartMs, drawEndMs: Date.now() };
}
