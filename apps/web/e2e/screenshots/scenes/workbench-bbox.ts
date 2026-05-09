import type { ScreenshotScene } from "./_types";

export const BBOX_SCENES: ScreenshotScene[] = [
  {
    name: "bbox/toolbar",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "locator", selector: '[data-testid="tool-dock"]', padding: 8 },
    // 高亮 bbox 工具按钮（红框）
    annotate: [
      { selector: '[data-testid="tool-btn-bbox"]', style: "rect-red", label: "矩形框工具" },
    ],
    mask: ["[data-testid='task-counter']"],
    matrix: { themes: ["light", "dark"] },
    target: "docs-site/user-guide/images/bbox/toolbar.png",
  },
  {
    name: "bbox/iou",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // IoU 重叠双框需手动准备数据；此处仅截工作台基线
    },
    target: "docs-site/user-guide/images/bbox/iou.png",
  },
  {
    name: "bbox/bulk-edit",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
    target: "docs-site/user-guide/images/bbox/bulk-edit.png",
  },
];
