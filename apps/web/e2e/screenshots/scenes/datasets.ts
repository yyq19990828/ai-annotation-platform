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
];
