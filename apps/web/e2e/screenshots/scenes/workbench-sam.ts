import type { ScreenshotScene } from "./_types";

// SAM 工具截图。
// 历史变更：旧的 sam-subtoolbar / sam-text-output-mode 体系曾重构为 AIToolDrawer（右侧抽屉）；
// 自 v0.18.25 起 AIToolDrawer 退役, 改为画布顶部居中浮块 InteractiveToolBar
// （testid=interactive-toolbar）。文字提示(text-prompt)已从工具栏摘除（见 stage/tools/index.ts:160），
// 故旧 sam/text-three-modes 场景移除。
export const SAM_SCENES: ScreenshotScene[] = [
  {
    name: "sam/subtoolbar",
    role: "annotator",
    fixture: {
      project: "image_demo",
      task: "annotating",
      backend: "image_interactive",
      capabilities: ["prompt:interactive_box", "output:polygon"],
    },
    route: (catalog) => {
      const project = catalog.projects.image_demo;
      return `/projects/${project.id}/annotate?task=${project.tasks.annotating.id}`;
    },
    prepare: async (page) => {
      await page.getByTestId("workbench-stage").waitFor({ timeout: 10_000 });
      const button = page.getByTestId("tool-btn-smart-box");
      await button.waitFor({ state: "visible" });
      if (!(await button.isEnabled())) throw new Error("sam/subtoolbar: smart-box 被禁用");
      await button.click();
      await page.getByTestId("interactive-toolbar").waitFor({ state: "visible" });
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="interactive-toolbar"]', padding: 8 },
    target: "docs-site/user-guide/images/sam/subtoolbar.png",
  },
];
