import type { ScreenshotScene } from "./_types";

// SAM 工具截图。
// 历史变更：旧的 sam-subtoolbar / sam-text-output-mode 体系已重构为 AIToolDrawer
// （激活 AI 工具后右侧抽屉，testid=ai-tool-drawer）。文字提示(text-prompt)已从工具栏摘除
// （见 stage/tools/index.ts:160），故旧 sam/text-three-modes 场景移除。
// AI 工具需绑定 backend 的项目才能激活：dev 环境 P-0001 注册了 gsam2。
const PROJECT_AI = "3f999396-65da-4f2b-a32d-d1560bad74b0"; // P-0001 · gsam2 connected

export const SAM_SCENES: ScreenshotScene[] = [
  {
    name: "sam/subtoolbar",
    role: "annotator",
    route: () => `/projects/${PROJECT_AI}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 }).catch(() => {});
      // 激活 AI 工具 smart-box，打开 AIToolDrawer（即新版「SAM 工具配置」）
      const btn = page.locator('[data-testid="tool-btn-smart-box"]');
      if (await btn.count()) await btn.click();
      await page.waitForSelector('[data-testid="ai-tool-drawer"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="ai-tool-drawer"]', padding: 8 },
    target: "docs-site/user-guide/images/sam/subtoolbar.png",
  },
];
