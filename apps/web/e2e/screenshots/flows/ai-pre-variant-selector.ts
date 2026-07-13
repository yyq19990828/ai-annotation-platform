/**
 * 流程录制：AI 预标变体选择器两轴联动（切选项 → 显存/精度/推荐 pill 联动）。
 *
 * 输出：outputs/flows/ai-pre-variant-selector.gif → docs-site/.../projects/ai-pre-variant-selector.gif
 *
 * /ai-pre 开项目详情面板，VariantSelector（data-testid=ai-variant-selector）下每轴是
 * select[data-testid^=ai-variant-]；切换选项时 metaRow 的「显存约 NGB / 均衡·精度 / 推荐」联动。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";

export async function runAiPreVariantSelector(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<void> {
  // ── Step 1：进 AI 预标，打开项目详情面板 ─────────────────────
  await page.goto("/ai-pre");
  await page.waitForLoadState("networkidle");
  const card = page.getByText(catalog.projects.image_demo.name, { exact: true }).first();
  await card.click();
  await page.waitForTimeout(900);

  // ── Step 2：滚到变体选择器 ───────────────────────────────────
  const selector = page.getByTestId("ai-variant-selector").first();
  await selector.waitFor({ timeout: 4000 });
  await selector.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);

  // ── Step 3：逐轴循环切换选项，metaRow（显存/精度/推荐）联动 ──
  const axes = selector.locator('select[data-testid^="ai-variant-"]');
  const axisCount = await axes.count();
  for (let a = 0; a < axisCount; a++) {
    const axis = axes.nth(a);
    await axis.scrollIntoViewIfNeeded();
    const optCount = await axis.locator("option").count();
    for (let i = 0; i < Math.min(3, optCount); i++) {
      await axis.selectOption({ index: i });
      await page.waitForTimeout(900);
    }
  }

  await page.waitForTimeout(1200);
}
