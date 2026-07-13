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
      await importBtn.click();
      await page.getByRole("dialog").waitFor({ timeout: 3000 });
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/datasets/import-images-wizard.png",
  },
  // NOTE: datasets/import-wizard-3d-type 暂不自动化 —— 向导第 1 步必须先上传文件
  // 「下一步」才可点，无文件无法进到「基本信息」步选 3D 点云。需文件上传 fixture，归 Tier B。
];
