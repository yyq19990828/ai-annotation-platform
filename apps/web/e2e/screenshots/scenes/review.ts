import type { ScreenshotScene } from "./_types";

import type { Page } from "@playwright/test";

const DARK_WORKBENCH_MATRIX: NonNullable<ScreenshotScene["matrix"]> = {
  themes: ["dark"],
  primaryTheme: "dark",
};

async function waitForReviewWorkbench(page: Page): Promise<void> {
  await page.getByTestId("review-reject").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(300);
}

const reviewRoute = (catalog: Parameters<ScreenshotScene["route"]>[0], openTask: boolean) => {
  const project = catalog.projects.image_demo;
  const params = new URLSearchParams({
    project: project.id,
    batch: project.batches.review.id,
  });
  if (openTask) params.set("taskId", project.tasks.review.id);
  return `/review?${params.toString()}`;
};

const reviewWorkbenchRoute = (catalog: Parameters<ScreenshotScene["route"]>[0]) => {
  const project = catalog.projects.image_demo;
  const params = new URLSearchParams({
    batch: project.batches.review.id,
    task: project.tasks.review.id,
    returnTo: `/review?project=${project.id}&batch=${project.batches.review.id}`,
  });
  return `/projects/${project.id}/review?${params.toString()}`;
};

export const REVIEW_SCENES: ScreenshotScene[] = [
  {
    name: "review/workbench",
    role: "reviewer",
    fixture: { project: "image_demo", task: "review", batch: "review" },
    route: reviewWorkbenchRoute,
    prepare: waitForReviewWorkbench,
    matrix: DARK_WORKBENCH_MATRIX,
    target: "docs-site/user-guide/images/review/workbench.png",
  },
  {
    name: "review/reject-form",
    role: "reviewer",
    fixture: { project: "image_demo", task: "review", batch: "review" },
    route: reviewWorkbenchRoute,
    prepare: async (page) => {
      await waitForReviewWorkbench(page);
      const rejectBtn = page.getByTestId("review-reject");
      await rejectBtn.click();
      await page.waitForTimeout(300);
    },
    // 只截拒回对话框，不露出后面的标注画布（Modal 无 reject-dialog testid，用 role=dialog）
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    matrix: DARK_WORKBENCH_MATRIX,
    target: "docs-site/user-guide/images/review/reject-form.png",
  },
  {
    // ReviewPage 全貌：左侧批次树 + 中央任务列表（缩略图 + 批量操作）
    name: "review/review-list-page",
    role: "reviewer",
    fixture: { project: "image_demo", batch: "review" },
    route: (catalog) => reviewRoute(catalog, false),
    prepare: async (page, catalog) => {
      await page.waitForLoadState("networkidle");
      await page
        .getByText(catalog.projects.image_demo.tasks.review.display_id, { exact: true })
        .waitFor({ state: "visible", timeout: 10_000 });
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/review/review-list-page.png",
  },
];
