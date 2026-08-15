/**
 * 高清母版：为一个已复核 3D 框启用“轨迹 · 属性”标签内容，随后环绕点云核对
 * billboard 文字在多个观察角度持续正对相机。源框由 spec 在录制窗口前准备并精确清理。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

type ViewportBox = { x: number; y: number; width: number; height: number };

async function dragOrbit(
  page: Page,
  box: ViewportBox,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const start = { x: box.x + box.width * from.x, y: box.y + box.height * from.y };
  const end = { x: box.x + box.width * to.x, y: box.y + box.height * to.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, start, end, 950);
  await page.mouse.up();
  await page.waitForTimeout(550);
}

export async function runPointcloudBillboardLabel(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.pointcloud_demo;
  const task = project.tasks.frame_000;
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  await page.waitForLoadState("domcontentloaded");

  const viewport = page.getByTestId("pc-viewport");
  await viewport.waitFor({ timeout: 20_000 });
  await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_500);

  const drawStartMs = Date.now();
  await page.waitForTimeout(2_600);

  await page.getByRole("button", { name: "工作台设置" }).first().click();
  const drawer = page.getByTestId("workbench-settings-drawer");
  await expect(drawer).toBeVisible();

  const labelContent = page.getByTestId("setting-field-common.labelContent");
  await labelContent.scrollIntoViewIfNeeded();
  await labelContent.getByRole("tab", { name: "轨迹" }).click();
  const attributesSwitch = labelContent
    .locator("label")
    .filter({ hasText: "属性" })
    .getByRole("switch");
  await expect(attributesSwitch).toHaveAttribute("data-state", "unchecked");
  await page.waitForTimeout(1_200);

  // PointCloudScene 用 CanvasTexture 绘制标签。记录切换后的 fillText 文本，确保属性
  // 不只是 UI 开关变更，而是真正进入 WebGL billboard 纹理。
  await page.evaluate(() => {
    const probeWindow = window as typeof window & { __pointcloudLabelTexts?: string[] };
    probeWindow.__pointcloudLabelTexts = [];
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.fillText;
    prototype.fillText = function (text, x, y, maxWidth) {
      probeWindow.__pointcloudLabelTexts?.push(String(text));
      if (maxWidth === undefined) return original.call(this, text, x, y);
      return original.call(this, text, x, y, maxWidth);
    };
  });

  await attributesSwitch.click();
  await expect(attributesSwitch).toHaveAttribute("data-state", "checked");
  await page.waitForFunction(
    () =>
      (
        window as typeof window & { __pointcloudLabelTexts?: string[] }
      ).__pointcloudLabelTexts?.some((text) => text === "object · 车辆 · 清晰可见"),
    undefined,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(1_800);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.waitForTimeout(900);

  const box = await viewport.boundingBox();
  if (!box) throw new Error("[pointcloud-billboard-label] 点云视口不可见");

  // 先拉近目标，再以四段连续 orbit 展示标签不随框平面倾斜、始终正对相机。
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  for (let index = 0; index < 3; index += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(700);

  await dragOrbit(page, box, { x: 0.3, y: 0.52 }, { x: 0.68, y: 0.44 });
  await dragOrbit(page, box, { x: 0.67, y: 0.46 }, { x: 0.42, y: 0.66 });
  await dragOrbit(page, box, { x: 0.43, y: 0.65 }, { x: 0.57, y: 0.3 });
  await dragOrbit(page, box, { x: 0.58, y: 0.34 }, { x: 0.32, y: 0.48 });
  await page.waitForTimeout(2_400);

  return { drawStartMs, drawEndMs: Date.now() };
}
