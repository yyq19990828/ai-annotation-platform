import type { ScreenshotScene } from "./_types";

export const EXPORT_SCENES: ScreenshotScene[] = [
  {
    name: "export/format-select",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/settings`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const exportTab = page.getByTestId("settings-tab-export");
      if (await exportTab.count()) await exportTab.click();
    },
    capture: { kind: "fullPage" },
    // 标号四种导出格式
    annotate: [
      { selector: '[data-testid="export-format-coco"]',    style: "numbered", label: "COCO JSON" },
      { selector: '[data-testid="export-format-yolo"]',    style: "numbered", label: "YOLO"      },
      { selector: '[data-testid="export-format-pascal"]',  style: "numbered", label: "Pascal VOC" },
      { selector: '[data-testid="export-format-labelme"]', style: "numbered", label: "LabelMe"   },
    ],
    target: "docs-site/user-guide/images/export/format-select.png",
  },
  {
    name: "export/progress",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/settings`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const exportTab = page.getByTestId("settings-tab-export");
      if (await exportTab.count()) await exportTab.click();
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/export/progress.png",
  },
];
