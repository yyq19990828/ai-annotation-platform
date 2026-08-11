/**
 * 流程录制：大图概览层稳定显示后，缩放与平移触发高清切片渐进替换。
 */
import type { Page, Response } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

function isPyramidRequest(response: Response, taskId: string): boolean {
  return response.url().includes(`/tasks/${taskId}/image-pyramid`);
}

export async function runLargeImageProgressive(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.large_image_demo;
  if (!project) {
    throw new Error(
      "[large-image-progressive] 截图库缺少 large_image_demo，请先生成 P-LARGE-IMG 的 Cosmic Cliffs 图像金字塔",
    );
  }
  const task = project.tasks.cosmic_cliffs;
  if (!task) throw new Error("[large-image-progressive] large_image_demo 缺少 cosmic_cliffs 任务");

  let signedBatchCount = 0;
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().includes(`/tasks/${task.id}/image-pyramid/asset-urls`) &&
      response.ok()
    ) {
      signedBatchCount += 1;
    }
  });

  const pyramidReady = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && isPyramidRequest(response, task.id) && response.ok(),
    { timeout: 20_000 },
  );
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  await pyramidReady;
  const stage = page.getByTestId("workbench-stage");
  await stage.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('[role="status"]')).some((node) =>
        node.textContent?.includes("高清切片生成中"),
      ),
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_500);

  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error("[large-image-progressive] 大图画布不可见");
  const drawStartMs = Date.now();
  const zoomX = stageBox.x + stageBox.width * 0.72;
  const zoomY = stageBox.y + stageBox.height * 0.48;
  await page.mouse.move(zoomX, zoomY);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(260);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(800);

  const panStartX = stageBox.x + stageBox.width * 0.54;
  const panStartY = stageBox.y + stageBox.height * 0.52;
  await page.keyboard.down("Space");
  await page.mouse.move(panStartX, panStartY);
  await page.mouse.down();
  await page.mouse.move(panStartX - stageBox.width * 0.16, panStartY + stageBox.height * 0.08, {
    steps: 16,
  });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(850);

  await page.mouse.move(stageBox.x + stageBox.width * 0.82, stageBox.y + stageBox.height * 0.42);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -360);
  await page.keyboard.up("Control");
  await page.waitForTimeout(1_200);

  if (signedBatchCount === 0) {
    throw new Error("[large-image-progressive] 缩放平移后未观测到高清切片签名请求");
  }
  return { drawStartMs, drawEndMs: Date.now() };
}
