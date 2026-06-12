import type { ScreenshotScene } from "./_types";

// AI 工具只在绑定了 ML backend 的项目里可激活（否则工具按钮置灰，drawer 打不开）。
// dev 环境里 P-0001「2D图片标注测试」注册了 gsam2 backend，故 AI 工具 scene 固定指向它。
const PROJECT_AI = "3f999396-65da-4f2b-a32d-d1560bad74b0"; // P-0001 · gsam2 connected

// 工作台布局 + AI 工具体系截图。
// 工具激活：ToolDock 按钮 testid 为 `tool-btn-{id}`，AI 工具(smart-point/smart-box/exemplar)
// 激活后右侧打开 AIToolDrawer(testid=ai-tool-drawer)；mask 工具激活后画布上方浮 MaskToolbar(testid=mask-toolbar)。
// AI 工具能否激活取决于 backend capability（seed 项目 P-0001 绑定 gsam2）。

export const WORKBENCH_AI_SCENES: ScreenshotScene[] = [
  {
    name: "workbench/layout-overview",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    },
    // 四区全貌用视口截图（不设 capture）
    target: "docs-site/user-guide/images/workbench/layout-overview.png",
  },
  {
    name: "mask-brush/toolbar-overview",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 }).catch(() => {});
      // 激活 mask 工具（hotkey M / tool-btn-mask）
      const maskBtn = page.locator('[data-testid="tool-btn-mask"]');
      if (await maskBtn.count()) {
        await maskBtn.click();
      } else {
        await page.keyboard.press("m");
      }
      await page.waitForSelector('[data-testid="mask-toolbar"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="mask-toolbar"]', padding: 12 },
    annotate: [
      { selector: '[data-testid="mask-mode-brush"]',  style: "rect-red", label: "笔刷" },
      { selector: '[data-testid="mask-mode-erase"]',  style: "rect-red", label: "橡皮" },
      { selector: '[data-testid="mask-radius-slider"]', style: "numbered" },
    ],
    target: "docs-site/user-guide/images/mask-brush/toolbar-overview.png",
  },
  {
    name: "sam/ai-tool-drawer",
    role: "annotator",
    route: () => `/projects/${PROJECT_AI}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 }).catch(() => {});
      // 激活 AI 工具 smart-box（bbox prompt，grounded-sam2 支持），打开 AIToolDrawer
      const btn = page.locator('[data-testid="tool-btn-smart-box"]');
      if (await btn.count()) await btn.click();
      await page.waitForSelector('[data-testid="ai-tool-drawer"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="ai-tool-drawer"]', padding: 8 },
    target: "docs-site/user-guide/images/sam/ai-tool-drawer.png",
  },
  // NOTE: sam/exemplar-output-mode 暂不自动化 —— gsam2 不支持 exemplar prompt，
  // 工具按钮置灰无法激活。需注册支持 exemplar 的 backend 后再补 scene。
];
