import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { openImageAnnotate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runAiPredictionImport(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  options: { marketing?: boolean } = {},
): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog, "predicted");
  const stage = page.getByTestId("workbench-stage");
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-user-box-count", "0", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-ai-box-count", "5", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-sam-candidate-count", "0", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-pending-drawing", "false", { timeout: 10_000 });
  // image-ready 表示资源已解码；再在裁剪窗口前留出一次稳定绘制，
  // 避免母版首帧仍是 Konva 透明棋盘。
  await page.waitForTimeout(1_000);
  const drawStartMs = Date.now();
  await page.waitForTimeout(options.marketing ? 2_500 : 500);

  const collapseDetails = page.getByTitle("收起标注详情");
  if (!(await collapseDetails.isVisible())) {
    await page.getByTitle("展开标注详情").click();
  }
  await collapseDetails.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(options.marketing ? 1_000 : 0);
  const candidate = page.locator('[data-testid^="box-list-item-"]').first();
  await candidate.waitFor({ state: "visible", timeout: 10_000 });
  await candidate.click();
  await page.waitForTimeout(options.marketing ? 1_500 : 200);
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/predictions\/[^/]+\/accept(?:\?|$)/.test(response.url()) &&
      response.ok(),
    { timeout: 20_000 },
  );
  // 选中对象详情会覆盖列表行的 hover 操作区；使用产品公开的 A 快捷键采纳当前候选，
  // 同时真实展示“选中 → 快捷决策 → 候选转人工”的工作流。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("A");
  await accepted;
  await expect(stage).toHaveAttribute("data-user-box-count", "1", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-ai-box-count", "4", { timeout: 10_000 });
  await page.waitForTimeout(options.marketing ? 3_200 : 500);
  return { drawStartMs, drawEndMs: Date.now() };
}
