/**
 * 流程录制：Tab 进入 AI 待审候选，A/D 决策后自动推进到下一项。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export interface CandidateReviewWindow extends DrawWindow {
  autoAdvanceStartMs: number;
}

async function waitForSelectedCandidate(
  page: Page,
  predictionIds: string[],
  exclude?: string,
): Promise<string> {
  const testIds = predictionIds.map((id) => `box-list-item-pred-${id}-0`);
  await page.waitForFunction(
    ({ ids, excluded }) =>
      ids.some((testId) => {
        if (testId === excluded) return false;
        const row = document.querySelector(`[data-testid="${testId}"]`);
        return row?.className.includes("border-brand") ?? false;
      }),
    { ids: testIds, excluded: exclude ? `box-list-item-pred-${exclude}-0` : null },
  );
  return await page.evaluate(
    ({ ids, excluded }) => {
      const selected = ids.find((testId) => {
        if (testId === excluded) return false;
        const row = document.querySelector(`[data-testid="${testId}"]`);
        return row?.className.includes("border-brand") ?? false;
      });
      if (!selected) throw new Error("未找到选中的 AI 候选");
      return selected.replace(/^box-list-item-pred-/, "").replace(/-0$/, "");
    },
    { ids: testIds, excluded: exclude ? `box-list-item-pred-${exclude}-0` : null },
  );
}

export async function runCandidateKeyboardReview(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  predictionIds: string[],
): Promise<CandidateReviewWindow> {
  if (predictionIds.length < 3) {
    throw new Error("[candidate-keyboard-review] 至少需要 3 条候选");
  }
  const project = catalog.projects.image_demo;
  const task = project.tasks.annotating;
  const rows = predictionIds.map((id) => page.getByTestId(`box-list-item-pred-${id}-0`));

  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  const stage = page.getByTestId("workbench-stage");
  await stage.waitFor({ state: "visible", timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 10_000 });
  await rows[0].waitFor({ state: "visible", timeout: 10_000 });
  const section = page.getByTestId("section-header-ai");
  if ((await section.getAttribute("aria-expanded")) === "false") {
    await section.click();
    await rows[0].waitFor({ state: "visible", timeout: 5_000 });
  }
  await page.getByTestId("tool-btn-select").click();
  await rows[0].click();
  await waitForSelectedCandidate(page, [predictionIds[0]]);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(1_000);

  const drawStartMs = Date.now();
  await page.waitForTimeout(1_500);
  await page.keyboard.press("Tab");
  const firstDecisionId = await waitForSelectedCandidate(page, predictionIds, predictionIds[0]);
  await page.waitForTimeout(1_300);

  const autoAdvanceStartMs = Date.now();
  await page.keyboard.press("A");
  await page
    .getByTestId(`box-list-item-pred-${firstDecisionId}-0`)
    .waitFor({ state: "hidden", timeout: 10_000 });
  const remainingAfterAccept = predictionIds.filter((id) => id !== firstDecisionId);
  const secondDecisionId = await waitForSelectedCandidate(page, remainingAfterAccept);
  await page.waitForTimeout(1_500);

  await page.keyboard.press("D");
  await page
    .getByTestId(`box-list-item-pred-${secondDecisionId}-0`)
    .waitFor({ state: "hidden", timeout: 10_000 });
  const finalDecisionId = await waitForSelectedCandidate(
    page,
    remainingAfterAccept.filter((id) => id !== secondDecisionId),
  );
  await page.getByTestId(`box-list-item-pred-${finalDecisionId}-0`).waitFor({ state: "visible" });
  await page.waitForTimeout(1_500);
  await page.keyboard.press("A");
  await page
    .getByTestId(`box-list-item-pred-${finalDecisionId}-0`)
    .waitFor({ state: "hidden", timeout: 10_000 });
  const manualHeader = page.getByTestId("section-header-manual");
  await manualHeader.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="section-header-manual"]')?.textContent ?? "";
    return /[1-9]\d*/.test(text);
  });
  await page.waitForTimeout(3_200);
  return { drawStartMs, autoAdvanceStartMs, drawEndMs: Date.now() };
}
