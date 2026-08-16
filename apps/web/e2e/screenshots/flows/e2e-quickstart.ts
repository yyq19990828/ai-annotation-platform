/**
 * M3 · 流程录制：快速入门（登录 → 进项目 → 画框 → 提交）。
 *
 * 输出：outputs/flows/e2e-quickstart.gif（< 5MB）
 *       outputs/flows/e2e-quickstart.webm（原始录屏）
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  installRecordingWorkbenchLayout,
  waitForRecordingWorkbenchLayout,
} from "./_workbench-layout";
import {
  mediaBbox,
  movePointerAtRefreshRate,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";

export async function runE2eQuickstart(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  options: { marketing?: boolean } = {},
): Promise<void> {
  const hold = (normalMs: number, marketingMs: number) =>
    page.waitForTimeout(options.marketing ? marketingMs : normalMs);

  // ── Step 1：登录 ─────────────────────────────────────────────
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await hold(0, 900);
  await page.getByPlaceholder("输入账号或邮箱").fill(catalog.users.admin.email);
  await page.getByPlaceholder("••••••••").fill("123456");
  await hold(500, 1_200); // 让录屏捕捉输入状态
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  await installRecordingWorkbenchLayout(page, "none", {
    image: { afterBoxCreate: "pick_class" },
  });

  // ── Step 2：进入标注工作台 ───────────────────────────────────
  const project = catalog.projects.image_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.clean.id}`);
  const stage = page.getByTestId("workbench-stage");
  await stage.waitFor({ state: "visible", timeout: 10_000 });
  await waitForRecordingWorkbenchLayout(page, "none");
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 10_000 });
  const initialImageIdentity = await stage.getAttribute("data-image-identity");
  if (!initialImageIdentity) {
    throw new Error("[e2e-quickstart] 当前题缺少稳定的图像 identity");
  }
  await hold(600, 1_800);

  // ── Step 3：激活 bbox 工具 ───────────────────────────────────
  const bboxBtn = page.getByTestId("tool-btn-box");
  await bboxBtn.click();
  await hold(300, 800);

  // ── Step 4：在画布上拖拽一个框（演示位置）────────────────────
  const box = await renderedMediaBounds(stage);
  const anchor = recordingAnchor(catalog, "image_demo", "clean", "primary_truck");
  const { start, end } = mediaBbox(box, anchor.bbox);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(options.marketing ? 250 : 80);
  if (options.marketing) {
    await movePointerAtRefreshRate(page, start, end, 900);
  } else {
    await page.mouse.move(end.x, end.y, { steps: 20 });
  }
  await page.mouse.up();
  const classPicker = page.getByTestId("class-picker-popover");
  await classPicker.waitFor({ state: "visible", timeout: 5_000 });
  await hold(0, 900);
  const annotationSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/annotations(?:\?|$)/.test(response.url()) &&
      response.ok(),
    { timeout: 10_000 },
  );
  await classPicker.getByText(anchor.label, { exact: true }).last().click();
  const annotationResponse = await annotationSaved;
  await expect(annotationResponse.json()).resolves.toMatchObject({
    task_id: project.tasks.clean.id,
    class_name: anchor.label,
  });
  await classPicker.waitFor({ state: "hidden", timeout: 5_000 });
  await hold(800, 1_800);

  // ── Step 5：提交标注 ─────────────────────────────────────────
  const submitBtn = page.getByRole("button", { name: "提交质检" });
  await submitBtn.click();
  await page
    .getByText(`已提交 ${project.tasks.clean.display_id} 至质检`, { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  await page
    .getByText(project.tasks.clean.display_id, { exact: true })
    .waitFor({ state: "hidden", timeout: 10_000 });
  await expect(stage).not.toHaveAttribute("data-image-identity", initialImageIdentity, {
    timeout: 10_000,
  });
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-user-box-count", "0", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-sam-candidate-count", "0", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-pending-drawing", "false", { timeout: 10_000 });
  await hold(800, 4_500);
}
