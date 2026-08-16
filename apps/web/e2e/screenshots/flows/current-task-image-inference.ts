/**
 * 当前题图片推理完整链路：已保存项目编排 → 真实 OCR → 候选审阅 → 单项采纳。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";
import type { OcrCleanupRecord } from "./ocr-inference";
import { dockAiPanelAtViewportRight, waitForRecordingWorkbenchLayout } from "./_workbench-layout";

export async function runCurrentTaskImageInference(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  onDispatched?: (record: OcrCleanupRecord) => void,
): Promise<DrawWindow> {
  const project = catalog.projects.ocr_demo;
  const backend = project.ml_backend;
  const hasE2e = (backend?.capabilities.models ?? []).some((model) => model.id === "ocr-e2e");
  if (!backend?.name.toLowerCase().includes("rapidocr") || !hasE2e) {
    throw new Error(
      "[current-task-image-inference] P-OCR 未绑定含 ocr-e2e 的真实 RapidOCR backend",
    );
  }

  const task = project.tasks.ocr;
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  const stage = page.getByTestId("workbench-stage");
  await stage.waitFor({ state: "visible", timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-user-box-count", "0", { timeout: 10_000 });
  await waitForRecordingWorkbenchLayout(page, "both");
  await page.waitForTimeout(1_000);

  const drawStartMs = Date.now();
  await page.waitForTimeout(2_400);

  await page.getByTestId("workbench-ai-single").click();
  const panel = page.getByTestId("ai-prediction-popover");
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  await dockAiPanelAtViewportRight(page, panel);
  const pipelineButton = panel.getByRole("button", {
    name: "运行当前题（按项目编排 · 1 阶段）",
    exact: true,
  });
  await pipelineButton.waitFor({ state: "visible", timeout: 10_000 });
  await expect(pipelineButton).toBeEnabled();
  await page.waitForTimeout(2_300);

  const responsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        url.pathname === `/api/v1/projects/${project.id}/preannotate`
      );
    },
    { timeout: 15_000 },
  );
  await pipelineButton.click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`[current-task-image-inference] 推理派发失败: HTTP ${response.status()}`);
  }
  const body = (await response.json()) as { job_id?: string };
  if (!body.job_id) {
    throw new Error("[current-task-image-inference] 推理响应缺少 job_id，无法无痕清理");
  }
  const cleanupRecord: OcrCleanupRecord = {
    projectId: project.id,
    taskId: task.id,
    celeryTaskId: body.job_id,
    annotationIds: [],
  };
  onDispatched?.(cleanupRecord);

  await page.waitForFunction(
    () => {
      const popover = document.querySelector('[data-testid="ai-prediction-popover"]');
      if (!popover || !/[1-9]\d*\s*待审/.test(popover.textContent ?? "")) return false;
      return Array.from(popover.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("运行当前题") && !button.disabled,
      );
    },
    undefined,
    { timeout: 120_000 },
  );
  const candidateCount = Number(await stage.getAttribute("data-ai-box-count"));
  if (!Number.isInteger(candidateCount) || candidateCount < 1) {
    throw new Error("[current-task-image-inference] 真实编排未生成可审阅候选");
  }
  await page.waitForTimeout(3_000);

  await panel.getByTitle("关闭当前题 AI").click();
  await panel.waitFor({ state: "hidden", timeout: 5_000 });
  const inspectorList = page.getByTestId("section-header-ai").locator("xpath=../../..");
  const candidate = page.locator('[data-testid^="box-list-item-pred-"]').first();
  await candidate.waitFor({ state: "visible", timeout: 10_000 });
  await candidate.scrollIntoViewIfNeeded();
  await candidate.click();
  await expect(candidate).toContainText(/\d+%/);
  await page.waitForTimeout(2_800);

  const accepted = page.waitForResponse(
    (candidateResponse) =>
      candidateResponse.request().method() === "POST" &&
      /\/predictions\/[^/]+\/accept(?:\?|$)/.test(candidateResponse.url()) &&
      candidateResponse.ok(),
    { timeout: 20_000 },
  );
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("A");
  const acceptedResponse = await accepted;
  const acceptedBody = (await acceptedResponse.json()) as Array<{ id?: string }>;
  cleanupRecord.annotationIds.push(
    ...acceptedBody.flatMap((annotation) =>
      typeof annotation.id === "string" ? [annotation.id] : [],
    ),
  );
  if (cleanupRecord.annotationIds.length === 0) {
    throw new Error("[current-task-image-inference] 采纳响应缺少 annotation id，无法无痕清理");
  }

  await expect(stage).toHaveAttribute("data-user-box-count", "1", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-ai-box-count", String(candidateCount - 1), {
    timeout: 10_000,
  });
  await inspectorList.evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }),
  );
  const manualSection = page.getByTestId("section-header-manual");
  await manualSection.waitFor({ state: "visible", timeout: 10_000 });
  await expect(manualSection).toContainText("1");
  await page.waitForTimeout(4_000);

  return { drawStartMs, drawEndMs: Date.now() };
}
