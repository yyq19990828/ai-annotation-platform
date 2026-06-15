import type { ScreenshotScene } from "./_types";

// 数据集导入向导截图。/datasets 页点「导入数据集」打开 ImportDatasetWizard modal。
export const DATASET_SCENES: ScreenshotScene[] = [
  {
    name: "datasets/import-images-wizard",
    role: "admin",
    route: () => "/datasets",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const importBtn = page.getByRole("button", { name: /导入数据集|导入|新建数据集/ }).first();
      if (await importBtn.count()) {
        await importBtn.click();
        await page.waitForTimeout(300);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/datasets/import-images-wizard.png",
  },
  {
    // 向导进到「基本信息」步，选「3D 点云」+ 勾「声明为时序数据集」
    name: "datasets/import-wizard-3d-type",
    role: "admin",
    route: () => "/datasets",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const importBtn = page.getByRole("button", { name: /导入数据集|导入|新建数据集/ }).first();
      if (await importBtn.count()) {
        await importBtn.click();
        await page.waitForTimeout(300);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
      // 选来源后进到「基本信息」步（数据类型 + 时序声明所在）
      const next = page.getByRole("button", { name: /下一步|继续/ }).first();
      if (await next.count()) {
        await next.click().catch(() => {});
        await page.waitForTimeout(350);
      }
      // 选 3D 点云数据类型
      const pc = page.getByText("3D 点云", { exact: false }).first();
      if (await pc.count()) {
        await pc.click().catch(() => {});
        await page.waitForTimeout(200);
      }
      // 勾「声明为时序数据集」
      const ts = page.getByText(/声明为时序数据集/).first();
      if (await ts.count()) {
        await ts.click().catch(() => {});
        await page.waitForTimeout(200);
      }
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/datasets/import-wizard-3d-type.png",
  },
];
