/**
 * M3 · 流程录制：AI 预标注（选项目 → 选批次 → 发起预标注 → 查看 job）。
 *
 * 输出：outputs/flows/ai-preannotate.gif
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runAiPreannotate(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  // ── Step 1：进入 AI 预标注入口 ───────────────────────────────
  await page.goto("/ai-pre");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const drawStartMs = Date.now();

  // ── Step 2：选择项目 ─────────────────────────────────────────
  const project = catalog.projects.image_demo;
  await page.getByText(project.name, { exact: true }).first().click();
  await page.getByRole("heading", { name: project.name }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(900);

  // ── Step 3：真实环境优先选可批量运行的 YOLO 后端 ──────────────
  // image_demo 的主后端是交互式 SAM3（batchable=false），它适合工作台智能工具，
  // 不适合批量预标。录制环境同时启用 YOLO 时显式切换，避免按钮因源模型不可批量而禁用。
  // 配置面板里可能同时存在源模型和隐藏的下游阶段选择器；直接从可用 option 反查
  // 所属 select，比依赖 CSS module 包装层中的 label 文本更稳定。
  const backendSelect = page
    .locator("select:visible")
    .filter({ has: page.locator('option:has-text("yolo-backend")') })
    .first();
  await expect(backendSelect).toBeVisible({ timeout: 10_000 });
  const yoloOption = backendSelect.locator("option").filter({ hasText: "yolo-backend" }).first();
  const yoloValue = await yoloOption.getAttribute("value");
  if (!yoloValue) throw new Error("[ai-preannotate] yolo-backend 选项缺少 value");
  await backendSelect.selectOption(yoloValue);
  await expect(backendSelect).toHaveValue(yoloValue);
  await page.waitForTimeout(900);

  // ── Step 4：选择批次 ─────────────────────────────────────────
  const batchRow = page.locator("li").filter({ hasText: project.batches.active.display_id });
  await batchRow.getByRole("checkbox").click();
  // 类别筛选现在是可选的模型原生类别白名单；截图 stub 不预热时按
  // “检出全部类别”运行，避免录制流程依赖具体模型的 model.names。
  await page.waitForTimeout(900);

  // ── Step 5：点击发起预标注 ───────────────────────────────────
  const startBtn = page.getByRole("button", { name: /跑预标（1 批）/ });
  await startBtn.waitFor({ state: "visible", timeout: 5000 });
  await expect(startBtn).toBeEnabled({ timeout: 15_000 });
  await startBtn.click();
  await page.waitForTimeout(1_500);

  // ── Step 6：查看历史列表 ─────────────────────────────────────
  await page.getByRole("button", { name: "历史 job" }).click();
  await page.waitForURL(/\/ai-pre\/jobs\?project_id=/, { timeout: 5000 });
  await page.waitForLoadState("networkidle");
  // 状态筛选下拉里也有一个隐藏的“已完成” option；只等待列表中的可见 Badge。
  await page
    .locator("span.bg-status-positive-soft")
    .filter({ hasText: /^已完成$/ })
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1_200);

  // 终态不是链路终点：打开 job 详情核对成功数，再进入工作台查看落到任务上的候选。
  const completedRow = page.locator("tbody tr").filter({ hasText: project.name }).first();
  await completedRow.click();
  await page.getByText("Job 详情", { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByText("成功", { exact: true }).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: "关闭" }).click();

  await completedRow.getByTitle("去工作台").click();
  await page.waitForURL(/\/projects\/[^/]+\/annotate/, { timeout: 10_000 });
  const stage = page.getByTestId("workbench-stage");
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 15_000 });
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('[data-testid="workbench-stage"]')
          ?.getAttribute("data-ai-box-count"),
      ) > 0,
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(2_000);
  return { drawStartMs, drawEndMs: Date.now() };
}
