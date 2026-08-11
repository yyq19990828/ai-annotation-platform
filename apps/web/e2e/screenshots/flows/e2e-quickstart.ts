/**
 * M3 · 流程录制：30s 快速入门（登录 → 进项目 → 画框 → 提交）。
 *
 * 输出：outputs/flows/e2e-quickstart.gif（< 5MB）
 *       outputs/flows/e2e-quickstart.webm（原始录屏）
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  installRecordingWorkbenchLayout,
  waitForRecordingWorkbenchLayout,
} from "./_workbench-layout";
import { mediaBbox, recordingAnchor } from "./_canvas";

export async function runE2eQuickstart(page: Page, catalog: ScreenshotSeedCatalog): Promise<void> {
  // ── Step 1：登录 ─────────────────────────────────────────────
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("输入账号或邮箱").fill(catalog.users.admin.email);
  await page.getByPlaceholder("••••••••").fill("123456");
  await page.waitForTimeout(500); // 让录屏捕捉输入状态
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  await page.waitForTimeout(800);
  await installRecordingWorkbenchLayout(page, "none");

  // ── Step 2：进入标注工作台 ───────────────────────────────────
  const project = catalog.projects.image_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.clean.id}`);
  await page.getByTestId("workbench-stage").waitFor({ state: "visible", timeout: 10_000 });
  await waitForRecordingWorkbenchLayout(page, "none");
  await page.waitForTimeout(1000);

  // ── Step 3：激活 bbox 工具 ───────────────────────────────────
  const bboxBtn = page.getByTestId("tool-btn-box");
  await bboxBtn.click();
  await page.waitForTimeout(500);

  // ── Step 4：在画布上拖拽一个框（演示位置）────────────────────
  const canvas = page.getByTestId("workbench-stage");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("[e2e-quickstart] workbench-stage 没有可见边界");
  const anchor = recordingAnchor(catalog, "image_demo", "clean", "primary_truck");
  const { start, end } = mediaBbox(box, anchor.bbox);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  // ── Step 5：提交标注 ─────────────────────────────────────────
  const submitBtn = page.getByRole("button", { name: "提交质检" });
  await submitBtn.click();
  await page.waitForTimeout(1000);
}
