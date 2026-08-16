/**
 * 流程录制：批次多选 → 批量操作工具栏浮现（含批量通过/驳回）。
 *
 * 输出：outputs/flows/batch-bulk-actions.gif → docs-site/.../projects/batch-bulk-actions.gif
 *
 * screenshots seed 的 image_demo 有四种状态批次，勾选后 BatchesSection 浮出
 * 「已选 N 个批次」工具栏（激活/通过/驳回/改派/归档/删除）。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runBatchBulkActions(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  // ── Step 1：进项目设置「批次管理」────────────────────────────
  await page.goto(`/projects/${catalog.projects.image_demo.id}/settings?section=batches`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
  const drawStartMs = Date.now();

  // ── Step 2：确保列表视图（行 checkbox 在列表态）──────────────
  const listTab = page.getByRole("button", { name: /^列表$|列表/ }).first();
  if (await listTab.count()) {
    await listTab.click();
    await page.waitForTimeout(700);
  }

  // ── Step 3：逐行勾选 → 批量工具栏浮现（停顿让录屏捕捉）───────
  const rows = page.locator("tbody tr");
  const eligible: number[] = [];
  for (let i = 0; i < (await rows.count()); i += 1) {
    const text = (await rows.nth(i).textContent()) ?? "";
    if (text.includes("标注中") || text.includes("已通过")) eligible.push(i);
  }
  if (eligible.length < 2) {
    throw new Error(`[batch-bulk-actions] 需要至少 2 个可归档批次，实际 ${eligible.length}`);
  }
  for (const index of eligible.slice(0, 2)) {
    await rows.nth(index).locator('input[type="checkbox"]').click();
    await page.waitForTimeout(800);
  }

  // ── Step 4：核对已选数量，执行可恢复的批量归档─────────
  await page.getByText(/已选/).first().waitFor({ timeout: 2000 });
  await page.waitForTimeout(1_200);
  await page.getByTitle("批量归档").click();
  const confirm = page.getByRole("dialog", { name: "批量归档" });
  await confirm.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(1_000);
  const archived = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/batches/bulk-archive") &&
      response.ok(),
    { timeout: 20_000 },
  );
  await confirm.getByRole("button", { name: "确认归档" }).click();
  await archived;
  await page.getByText("上次批量归档：", { exact: false }).waitFor({ timeout: 10_000 });
  await page.getByText("成功 2", { exact: true }).waitFor({ timeout: 10_000 });
  if (await page.getByText(/失败\s+[1-9]/).count()) {
    throw new Error("[batch-bulk-actions] 选中的可归档批次仍出现失败结果");
  }
  await page.waitForTimeout(3_000);
  return { drawStartMs, drawEndMs: Date.now() };
}
