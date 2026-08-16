/**
 * 图片候选完整审阅链路：跳过 → 采纳并自动前进 → 驳回并回到未决候选。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";
import { waitForRecordingWorkbenchLayout } from "./_workbench-layout";

export interface CandidateReviewCleanupRecord {
  projectId: string;
  taskId: string;
  predictionIds: string[];
  annotationIds: string[];
}

function predictionIdFromTestId(testId: string): string {
  return testId.replace(/^box-list-item-pred-/, "").replace(/-0$/, "");
}

async function selectedCandidateId(page: Page, allowedIds: string[]): Promise<string> {
  const testIds = allowedIds.map((id) => `box-list-item-pred-${id}-0`);
  await page.waitForFunction((ids) => {
    return ids.some((testId) => {
      const row = document.querySelector(`[data-testid="${testId}"]`);
      return row?.className.includes("border-brand") ?? false;
    });
  }, testIds);
  return page.evaluate((ids) => {
    const selected = ids.find((testId) => {
      const row = document.querySelector(`[data-testid="${testId}"]`);
      return row?.className.includes("border-brand") ?? false;
    });
    if (!selected) throw new Error("未找到选中的 AI 候选");
    return selected.replace(/^box-list-item-pred-/, "").replace(/-0$/, "");
  }, testIds);
}

export async function runCandidateReviewLifecycle(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  cleanup: CandidateReviewCleanupRecord,
): Promise<DrawWindow> {
  if (cleanup.predictionIds.length !== 3) {
    throw new Error("[candidate-review-lifecycle] 必须使用 3 条独立候选");
  }
  const project = catalog.projects.image_demo;
  const task = project.tasks.annotating;
  if (cleanup.projectId !== project.id || cleanup.taskId !== task.id) {
    throw new Error("[candidate-review-lifecycle] 清理范围与截图 catalog 不一致");
  }

  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  const stage = page.getByTestId("workbench-stage");
  await stage.waitFor({ state: "visible", timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-ai-box-count", "3", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-user-box-count", "0", { timeout: 10_000 });
  await waitForRecordingWorkbenchLayout(page, "both");

  const section = page.getByTestId("section-header-ai");
  if ((await section.getAttribute("aria-expanded")) === "false") await section.click();
  await expect(section).toContainText("3");
  await page.getByTestId("tool-btn-select").click();

  const allowed = new Set(cleanup.predictionIds);
  const orderedIds = await page
    .locator('[data-testid^="box-list-item-pred-"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid") ?? "").filter(Boolean))
    .then((testIds) =>
      testIds.map(predictionIdFromTestId).filter((predictionId) => allowed.has(predictionId)),
    );
  if (orderedIds.length !== 3 || new Set(orderedIds).size !== 3) {
    throw new Error("[candidate-review-lifecycle] 右栏未完整显示 3 条录制候选");
  }
  const rows = new Map(
    orderedIds.map((id) => [id, page.getByTestId(`box-list-item-pred-${id}-0`)]),
  );
  for (const row of rows.values()) await row.waitFor({ state: "visible", timeout: 10_000 });

  await page.waitForTimeout(1_000);
  const drawStartMs = Date.now();
  await page.waitForTimeout(3_400);

  const skippedId = orderedIds[0];
  await rows.get(skippedId)!.click();
  await expect(rows.get(skippedId)!).toHaveClass(/border-brand/);
  await page.waitForTimeout(3_200);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  const acceptedId = await selectedCandidateId(page, orderedIds);
  if (acceptedId === skippedId) {
    throw new Error("[candidate-review-lifecycle] Tab 未跳到下一条候选");
  }
  await expect(rows.get(skippedId)!).toBeVisible();
  await expect(section).toContainText("3");
  await page.waitForTimeout(3_600);

  const acceptedResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/predictions\/[^/]+\/accept(?:\?|$)/.test(response.url()) &&
      response.ok(),
    { timeout: 20_000 },
  );
  await page.keyboard.press("A");
  const acceptedResponse = await acceptedResponsePromise;
  const accepted = (await acceptedResponse.json()) as Array<{ id?: string }>;
  cleanup.annotationIds.push(
    ...accepted.flatMap((annotation) => (typeof annotation.id === "string" ? [annotation.id] : [])),
  );
  if (cleanup.annotationIds.length !== 1) {
    throw new Error("[candidate-review-lifecycle] 采纳响应未返回唯一 annotation id");
  }
  await rows.get(acceptedId)!.waitFor({ state: "hidden", timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-ai-box-count", "2", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-user-box-count", "1", { timeout: 10_000 });

  const rejectedId = await selectedCandidateId(
    page,
    orderedIds.filter((id) => id !== acceptedId),
  );
  if (rejectedId === skippedId) {
    throw new Error("[candidate-review-lifecycle] 采纳后未自动前进到第三条候选");
  }
  await page.waitForTimeout(3_600);

  const rejectedResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/predictions\/[^/]+\/reject(?:\?|$)/.test(response.url()) &&
      response.status() === 204,
    { timeout: 20_000 },
  );
  await page.keyboard.press("D");
  await rejectedResponsePromise;
  await rows.get(rejectedId)!.waitFor({ state: "hidden", timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-ai-box-count", "1", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-user-box-count", "1", { timeout: 10_000 });
  await expect(section).toContainText("1");
  await expect(page.getByTestId("section-header-manual")).toContainText("1");
  await expect(rows.get(skippedId)!).toBeVisible();
  await expect(rows.get(skippedId)!).toHaveClass(/border-brand/);
  if ((await selectedCandidateId(page, [skippedId])) !== skippedId) {
    throw new Error("[candidate-review-lifecycle] 驳回后未回到仍待审的跳过候选");
  }
  await page.waitForTimeout(5_600);

  return { drawStartMs, drawEndMs: Date.now() };
}
