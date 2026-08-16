/** 高清母版：项目列表中的高频数据操作入口。 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

const pointerByPage = new WeakMap<Page, { x: number; y: number }>();

async function moveTo(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("[project-actions-menu] 目标控件不可见");
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await movePointerAtRefreshRate(page, pointerByPage.get(page) ?? { x: 90, y: 110 }, target, 260);
  pointerByPage.set(page, target);
}

export async function runProjectActionsMenu(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.image_demo;
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10_000 });
  const row = page.locator("tr", { hasText: project.name });
  await expect(row).toBeVisible({ timeout: 10_000 });

  const drawStartMs = Date.now();
  await page.waitForTimeout(2_400);

  const menuButton = row.getByTitle("更多操作");
  await moveTo(page, menuButton);
  await menuButton.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  const exportItem = menu.getByRole("menuitem", { name: "导出标注数据" });
  const copyItem = menu.getByRole("menuitem", { name: "复制项目配置" });
  const importItem = menu.getByRole("menuitem", { name: "导入预测" });
  await expect(exportItem).toBeVisible();
  await expect(copyItem).toBeVisible();
  await expect(importItem).toBeVisible();
  await page.waitForTimeout(1_400);

  await moveTo(page, exportItem);
  await page.waitForTimeout(1_800);
  await moveTo(page, copyItem);
  await page.waitForTimeout(1_800);
  await moveTo(page, importItem);
  await page.waitForTimeout(2_600);

  return { drawStartMs, drawEndMs: Date.now() };
}
