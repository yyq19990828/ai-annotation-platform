/**
 * M3 · 流程录制：30s 快速入门（登录 → 进项目 → 画框 → 提交）。
 *
 * 输出：outputs/flows/e2e-quickstart.gif（< 5MB）
 *       outputs/flows/e2e-quickstart.webm（原始录屏）
 */
import type { Page } from "@playwright/test";
import type { SeedData } from "../../fixtures/seed";

export async function runE2eQuickstart(page: Page, data: SeedData): Promise<void> {
  // ── Step 1：登录 ─────────────────────────────────────────────
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("输入账号或邮箱").fill(data.admin_email);
  await page.getByPlaceholder("••••••••").fill("Test1234");
  await page.waitForTimeout(500); // 让录屏捕捉输入状态
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  await page.waitForTimeout(800);

  // ── Step 2：进入标注工作台 ───────────────────────────────────
  if (!data.project_id) {
    console.warn("[e2e-quickstart] 无项目数据，跳过工作台步骤");
    return;
  }
  await page.goto(`/projects/${data.project_id}/annotate`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // ── Step 3：激活 bbox 工具 ───────────────────────────────────
  const bboxBtn = page.getByTestId("tool-btn-bbox");
  if (await bboxBtn.count()) {
    await bboxBtn.click();
    await page.waitForTimeout(500);
  } else {
    await page.keyboard.press("b");
    await page.waitForTimeout(500);
  }

  // ── Step 4：在画布上拖拽一个框（演示位置）────────────────────
  const canvas = page.getByTestId("annotation-canvas").first();
  if (await canvas.count()) {
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width  * 0.3;
      const cy = box.y + box.height * 0.3;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + box.width * 0.25, cy + box.height * 0.25, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    }
  }

  // ── Step 5：提交标注 ─────────────────────────────────────────
  const submitBtn = page.getByTestId("submit-annotation");
  if (await submitBtn.count()) {
    await submitBtn.click();
    await page.waitForTimeout(1000);
  }
}
