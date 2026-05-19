import type { ScreenshotScene } from "./_types";

// v0.10.18 · bbox/iou + bbox/bulk-edit 直接跳到 P-0001 项目下有真实密集标注的任务,
// 不再 mock annotations (mock shape 易跟生成类型漂移导致 React 错误边界触发).
// P-0001 (3f999396-65da-4f2b-a32d-d1560bad74b0) 是 image-det 项目, task DEMO_TASK_ID
// 在 dev DB 当前持 47 条真实 bbox 标注, 适合演示密集框 / 批量选择.

const IMAGE_PROJECT_ID = "3f999396-65da-4f2b-a32d-d1560bad74b0";
const DEMO_TASK_ID = "0207968d-1af9-4c66-b75a-44ed1fd35343";

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
    role: "admin",
    route: () => `/projects/${IMAGE_PROJECT_ID}/annotate?task=${DEMO_TASK_ID}`,
    prepare: async (page) => {
      // v0.10.18 · 直接进 P-0001 + DEMO_TASK_ID, 47 条真实标注里 IoU 重叠的框天然存在
      await page.waitForLoadState("networkidle");
      // 等画布稳定渲染
      await page.waitForTimeout(1200);
    },
    target: "docs-site/user-guide/images/bbox/iou.png",
  },
  {
    name: "bbox/bulk-edit",
    role: "admin",
    route: () => `/projects/${IMAGE_PROJECT_ID}/annotate?task=${DEMO_TASK_ID}`,
    prepare: async (page) => {
      // v0.10.18 · Ctrl+A 全选 47 框触发批量编辑栏
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(800);
      // Ctrl+A 走 workbench hotkey
      await page.keyboard.press("Control+a");
      await page.waitForTimeout(500);
    },
    target: "docs-site/user-guide/images/bbox/bulk-edit.png",
  },
];
