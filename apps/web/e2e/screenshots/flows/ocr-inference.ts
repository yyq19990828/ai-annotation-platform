/**
 * 流程录制：真实 RapidOCR 当前题推理。
 *
 * 开启当前题 AI → 显式选择 ocr-e2e → 运行真实后端 → 等待多边形+文本候选出现。
 * 不采纳候选；持久化 prediction / job 由 flows.spec 按本次 id 精确清理，
 * 平台不可变审计记录按安全设计保留。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";
import { dockAiPanelAtViewportRight, waitForRecordingWorkbenchLayout } from "./_workbench-layout";

export interface OcrCleanupRecord {
  projectId: string;
  taskId: string;
  celeryTaskId: string;
}

export interface OcrInferenceRecording extends DrawWindow, OcrCleanupRecord {}

export async function runOcrInference(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  onDispatched?: (record: OcrCleanupRecord) => void,
): Promise<OcrInferenceRecording> {
  const project = catalog.projects.ocr_demo;
  const backend = project.ml_backend;
  const models = backend?.capabilities.models ?? [];
  const hasE2e = models.some((model) => model.id === "ocr-e2e");
  if (!backend?.name.toLowerCase().includes("rapidocr") || !hasE2e) {
    throw new Error("[ocr-inference] P-OCR 未绑定含 ocr-e2e 的真实 RapidOCR backend");
  }

  const task = project.tasks.ocr;
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  await page.getByTestId("workbench-stage").waitFor({ state: "visible", timeout: 15_000 });
  await waitForRecordingWorkbenchLayout(page, "both");
  await page.waitForTimeout(900);

  await page.getByTestId("workbench-ai-single").click();
  const panel = page.getByTestId("ai-prediction-popover");
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  await dockAiPanelAtViewportRight(page, panel);

  const modelField = panel.locator("label").filter({ hasText: "模型任务" });
  const modelSelect = modelField.locator("select");
  if (await modelSelect.count()) {
    await modelSelect.selectOption("ocr-e2e");
  } else if (
    !(await panel.getByText("当前模型").locator("..").textContent())?.includes("端到端 OCR")
  ) {
    throw new Error("[ocr-inference] 当前题 AI 未提供 ocr-e2e 模型");
  }
  await page.waitForTimeout(700);

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

  const drawStartMs = Date.now();
  await panel.getByRole("button", { name: "运行当前题", exact: true }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`[ocr-inference] 推理派发失败: HTTP ${response.status()}`);
  }
  const body = (await response.json()) as { job_id?: string };
  if (!body.job_id) {
    throw new Error("[ocr-inference] 推理响应缺少 job_id，无法无痕清理");
  }
  const cleanupRecord = {
    projectId: project.id,
    taskId: task.id,
    celeryTaskId: body.job_id,
  };
  onDispatched?.(cleanupRecord);

  // 真正完成以 WS 触发的 predictions 重拉和非零待审数为准，
  // POST 200 只代表 Celery 已派发。RapidOCR 首次冷加载给足 120s。
  await page.waitForFunction(
    () => {
      const popover = document.querySelector('[data-testid="ai-prediction-popover"]');
      if (!popover || !/[1-9]\d*\s*待审/.test(popover.textContent ?? "")) return false;
      return Array.from(popover.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "运行当前题" && !button.disabled,
      );
    },
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(1800);

  return {
    drawStartMs,
    drawEndMs: Date.now(),
    ...cleanupRecord,
  };
}
