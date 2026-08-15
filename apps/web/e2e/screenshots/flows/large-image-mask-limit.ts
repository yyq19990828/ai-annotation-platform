/**
 * 流程录制：超大图保持分块浏览与矢量标注，同时明确呈现 Mask 尺寸上限。
 */
import { expect, type Page, type Response } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { commitPendingAnnotationClass, movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

const MASK_LIMIT_REASON = "当前图片 14575×8441 超过 Mask 上限（单边 8192、总像素 67,108,864）";

function isPyramidRequest(response: Response, taskId: string): boolean {
  return response.url().includes(`/tasks/${taskId}/image-pyramid`);
}

export async function runLargeImageMaskLimit(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.large_image_demo;
  if (!project) {
    throw new Error(
      "[large-image-mask-limit] 截图库缺少 large_image_demo，请先生成 P-LARGE-IMG 的 Cosmic Cliffs 图像金字塔",
    );
  }
  const task = project.tasks.cosmic_cliffs;
  if (!task) throw new Error("[large-image-mask-limit] large_image_demo 缺少 cosmic_cliffs 任务");

  const pyramidReady = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && isPyramidRequest(response, task.id) && response.ok(),
    { timeout: 20_000 },
  );
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  await pyramidReady;

  const stage = page.getByTestId("workbench-stage");
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 15_000 });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('[role="status"]')).some((node) =>
        node.textContent?.includes("高清切片生成中"),
      ),
    undefined,
    { timeout: 10_000 },
  );

  const maskButton = page.getByTestId("tool-btn-mask");
  await expect(maskButton).toBeVisible();
  await expect(maskButton).toBeDisabled({ timeout: 10_000 });
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error("[large-image-mask-limit] 超大图画布不可见");

  const drawStartMs = Date.now();
  await page.waitForTimeout(1_200);

  const zoomX = stageBox.x + stageBox.width * 0.62;
  const zoomY = stageBox.y + stageBox.height * 0.48;
  await page.mouse.move(zoomX, zoomY);
  await page.keyboard.down("Control");
  for (let index = 0; index < 3; index += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(260);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(1_400);

  const boxButton = page.getByTestId("tool-btn-box");
  const boxButtonBounds = await boxButton.boundingBox();
  if (!boxButtonBounds) throw new Error("[large-image-mask-limit] 矩形工具不可见");
  await movePointerAtRefreshRate(
    page,
    { x: zoomX, y: zoomY },
    {
      x: boxButtonBounds.x + boxButtonBounds.width / 2,
      y: boxButtonBounds.y + boxButtonBounds.height / 2,
    },
    500,
  );
  await boxButton.click();
  await page.waitForTimeout(500);

  const start = {
    x: stageBox.x + stageBox.width * 0.48,
    y: stageBox.y + stageBox.height * 0.34,
  };
  const end = {
    x: stageBox.x + stageBox.width * 0.66,
    y: stageBox.y + stageBox.height * 0.63,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(stage).toHaveAttribute("data-drag-kind", "draw", { timeout: 2_000 });
  await movePointerAtRefreshRate(page, start, end, 900);
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-pending-drawing", "true", { timeout: 2_000 });
  const saved = await commitPendingAnnotationClass(page, { label: "目标", taskId: task.id });
  const annotationId = saved.id;
  if (typeof annotationId !== "string") {
    throw new Error("[large-image-mask-limit] 矢量标注落库后缺少 annotation id");
  }
  await page.waitForTimeout(2_000);

  const maskButtonBounds = await maskButton.boundingBox();
  if (!maskButtonBounds) throw new Error("[large-image-mask-limit] Mask 工具入口不可见");
  await movePointerAtRefreshRate(
    page,
    end,
    {
      x: maskButtonBounds.x + maskButtonBounds.width / 2,
      y: maskButtonBounds.y + maskButtonBounds.height / 2,
    },
    600,
  );
  await maskButton.hover({ force: true });
  await expect(page.getByRole("tooltip").getByText(MASK_LIMIT_REASON, { exact: true })).toBeVisible(
    {
      timeout: 5_000,
    },
  );
  await page.waitForTimeout(3_000);

  const drawEndMs = Date.now();
  await page.waitForTimeout(1_200);

  const deleted = await page.evaluate(
    async ({ taskId, annotationId }) => {
      const token = localStorage.getItem("token");
      const response = await fetch(`/api/v1/tasks/${taskId}/annotations/${annotationId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return { ok: response.ok, status: response.status };
    },
    { taskId: task.id, annotationId },
  );
  if (!deleted.ok) {
    throw new Error(`[large-image-mask-limit] 清理临时矢量标注失败：HTTP ${deleted.status}`);
  }

  return { drawStartMs, drawEndMs };
}
