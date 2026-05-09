import type { ScreenshotScene } from "./_types";

export const REVIEW_SCENES: ScreenshotScene[] = [
  {
    name: "review/workbench",
    role: "reviewer",
    route: (d) => `/review?task=${d.task_ids[0]}`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
    target: "docs-site/user-guide/images/review/workbench.png",
  },
  {
    name: "review/reject-form",
    role: "reviewer",
    route: (d) => `/review?task=${d.task_ids[0]}`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const rejectBtn = page.getByTestId("review-reject");
      if (await rejectBtn.count()) {
        await rejectBtn.click();
        await page.waitForTimeout(200);
      }
    },
    // 只截拒回对话框，不露出后面的标注画布
    capture: { kind: "locator", selector: '[data-testid="reject-dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/review/reject-form.png",
  },
];
