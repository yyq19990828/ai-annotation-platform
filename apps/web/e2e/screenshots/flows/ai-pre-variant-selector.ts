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
import type { DrawWindow } from "./rotated-bbox";

export async function runAiPreVariantSelector(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  // ── Step 1：进 AI 预标，打开项目详情面板 ─────────────────────
  await page.goto("/ai-pre");
  await page.waitForLoadState("networkidle");
  const drawStartMs = Date.now();
  const card = page.getByText(catalog.projects.image_demo.name, { exact: true }).first();
  await card.click();
  await page.waitForTimeout(900);

  // ── Step 2：滚到变体选择器 ───────────────────────────────────
  const selector = page.getByTestId("ai-variant-selector").first();
  await selector.waitFor({ timeout: 4000 });
  await selector.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1400);

  // ── Step 3：切换到真正提供多档位的 YOLO 后端 ───────────────
  // screenshot 主绑定 SAM3 只提供单一推荐档，不能拿固定下拉凑“变体联动”素材。
  // 该单项录制会额外启用真实 yolo-backend，显式选择后再演示版本系列与尺寸档。
  const backendSelect = page
    .locator("select:visible")
    .filter({ has: page.locator('option:has-text("yolo-backend")') })
    .first();
  await backendSelect.waitFor({ state: "visible", timeout: 10_000 });
  const yoloOption = backendSelect.locator("option").filter({ hasText: "yolo-backend" }).first();
  const yoloValue = await yoloOption.getAttribute("value");
  if (!yoloValue) throw new Error("[ai-pre-variant-selector] yolo-backend 选项缺少 value");
  await backendSelect.selectOption(yoloValue);
  await page.waitForTimeout(1_200);

  // ── Step 4：逐轴循环切换选项，metaRow（显存/精度/推荐）联动 ──
  const axes = selector.locator('select[data-testid^="ai-variant-"]');
  const axisCount = await axes.count();
  let variableAxisCount = 0;
  for (let a = 0; a < axisCount; a++) {
    const axis = axes.nth(a);
    await axis.scrollIntoViewIfNeeded();
    const values = await axis
      .locator("option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    if (values.length < 2) continue;
    variableAxisCount += 1;
    const sequence =
      values.length >= 3
        ? [values[1], values[2], values[1], values[0]]
        : [values[1], values[0], values[1], values[0]];
    for (const value of sequence) {
      await axis.selectOption(value);
      await page.waitForTimeout(1300);
    }
  }
  if (variableAxisCount === 0) {
    throw new Error("[ai-pre-variant-selector] 当前模型没有可比较的变体档位");
  }

  await page.waitForTimeout(1800);
  return { drawStartMs, drawEndMs: Date.now() };
}
