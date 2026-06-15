import type { ScreenshotScene } from "./_types";

import type { Page } from "@playwright/test";

// 审核工作台截图。seed peek 默认 task（P-COCO8）不是 review 态，会截出空态；
// P-0001 已提交质检（review 态），但审核页需先点左侧批次加载任务列表，再「打开」任务
// 才会渲染右侧画布 + 操作面板。

/** 点左侧批次 → 打开第一个待审任务（让右侧 ReviewWorkbench 渲染）。 */
async function openFirstReviewTask(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  // 左侧批次树点 Batch（加载中央任务列表）
  const batch = page.getByText(/Batch 1/).first();
  if (await batch.count()) {
    await batch.click();
    await page.waitForTimeout(500);
  }
  // 打开第一个任务的审核画布（taskMain / actionCell「打开」按钮均触发 onOpen）
  const openBtn = page.getByRole("button", { name: /^打开$|审核/ }).first();
  if (await openBtn.count()) {
    await openBtn.click().catch(() => {});
  }
  await page.waitForSelector('[data-testid="review-reject"]', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
}

export const REVIEW_SCENES: ScreenshotScene[] = [
  {
    name: "review/workbench",
    role: "reviewer",
    route: () => "/review",
    prepare: openFirstReviewTask,
    target: "docs-site/user-guide/images/review/workbench.png",
  },
  {
    name: "review/reject-form",
    role: "reviewer",
    route: () => "/review",
    prepare: async (page) => {
      await openFirstReviewTask(page);
      const rejectBtn = page.getByTestId("review-reject");
      if (await rejectBtn.count()) {
        await rejectBtn.click();
        await page.waitForTimeout(300);
      }
    },
    // 只截拒回对话框，不露出后面的标注画布（Modal 无 reject-dialog testid，用 role=dialog）
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/review/reject-form.png",
  },
  {
    // ReviewPage 全貌：左侧批次树 + 中央任务列表（缩略图 + 批量操作）
    name: "review/review-list-page",
    role: "reviewer",
    route: () => "/review",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      // 点左侧批次加载中央任务列表，但不打开单任务画布
      const batch = page.getByText(/Batch 1/).first();
      if (await batch.count()) {
        await batch.click().catch(() => {});
        await page.waitForTimeout(500);
      }
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/review/review-list-page.png",
  },
];
