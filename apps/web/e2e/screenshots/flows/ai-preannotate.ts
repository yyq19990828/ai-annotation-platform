/**
 * M3 · 流程录制：AI 预标注（选项目 → 选批次 → 发起预标注 → 查看 job）。
 *
 * 输出：outputs/flows/ai-preannotate.gif
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";

export async function runAiPreannotate(page: Page, catalog: ScreenshotSeedCatalog): Promise<void> {
  // ── Step 1：进入 AI 预标注入口 ───────────────────────────────
  await page.goto("/ai-pre");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  // ── Step 2：选择项目 ─────────────────────────────────────────
  const project = catalog.projects.image_demo;
  await page.getByText(project.name, { exact: true }).first().click();
  await page.getByRole("heading", { name: project.name }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);

  // ── Step 3：选择批次 ─────────────────────────────────────────
  const batchRow = page.locator("li").filter({ hasText: project.batches.active.display_id });
  await batchRow.getByRole("checkbox").click();
  await page.getByPlaceholder(/例：car, person/).fill("car");
  await page.waitForTimeout(500);

  // ── Step 4：点击发起预标注 ───────────────────────────────────
  const startBtn = page.getByRole("button", { name: /跑预标（1 批）/ });
  await startBtn.waitFor({ state: "visible", timeout: 5000 });
  await startBtn.click();
  await page.waitForTimeout(1500);

  // ── Step 5：查看历史列表 ─────────────────────────────────────
  await page.getByRole("button", { name: "历史 job" }).click();
  await page.waitForURL(/\/ai-pre\/jobs\?project_id=/, { timeout: 5000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}
