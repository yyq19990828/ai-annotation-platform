import type { ScreenshotScene } from "./_types";

const imageTaskRoute = (
  catalog: Parameters<ScreenshotScene["route"]>[0],
  task: string,
) => {
  const project = catalog.projects.image_demo;
  return `/projects/${project.id}/annotate?task=${project.tasks[task].id}`;
};

// 工作台布局 + AI 工具体系截图。
// 工具激活：ToolDock 按钮 testid 为 `tool-btn-{id}`；AI 工具(smart-point/smart-box/exemplar)
// 激活后画布顶部居中浮 InteractiveToolBar(testid=interactive-toolbar, v0.18.25 取代旧 AIToolDrawer)；
// mask 工具激活后画布上方浮 MaskToolbar(testid=mask-toolbar)，两者互斥。
// AI 工具能否激活取决于 catalog 声明的 backend capability。

export const WORKBENCH_AI_SCENES: ScreenshotScene[] = [
  {
    name: "workbench/layout-overview",
    role: "annotator",
    fixture: { project: "image_demo", task: "annotating" },
    route: (catalog) => imageTaskRoute(catalog, "annotating"),
    prepare: async (page) => {
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 });
      await page.waitForTimeout(500);
    },
    // 四区全貌用视口截图（不设 capture）
    target: "docs-site/user-guide/images/workbench/layout-overview.png",
  },
  {
    name: "mask-brush/toolbar-overview",
    role: "annotator",
    fixture: { project: "image_demo", task: "annotating" },
    route: (catalog) => imageTaskRoute(catalog, "annotating"),
    prepare: async (page) => {
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 });
      await page.getByTestId("tool-btn-mask").click();
      await page.waitForSelector('[data-testid="mask-toolbar"]', { timeout: 3000 });
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
    name: "sam/smart-point-toolbar",
    role: "annotator",
    fixture: {
      project: "image_demo",
      task: "annotating",
      backend: "image_interactive",
      capabilities: ["prompt:point", "output:polygon"],
    },
    route: (catalog) => imageTaskRoute(catalog, "annotating"),
    prepare: async (page) => {
      await page.getByTestId("workbench-stage").waitFor({ timeout: 10_000 });
      const button = page.getByTestId("tool-btn-smart-point");
      await button.waitFor({ state: "visible" });
      if (!(await button.isEnabled())) throw new Error("sam/smart-point-toolbar: smart-point 被禁用");
      await button.click();
      await page.getByTestId("interactive-toolbar").waitFor({ state: "visible" });
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="interactive-toolbar"]', padding: 8 },
    target: "docs-site/user-guide/images/sam/smart-point-toolbar.png",
  },
  {
    name: "sam/interactive-toolbar",
    role: "annotator",
    fixture: {
      project: "image_demo",
      task: "annotating",
      backend: "image_interactive",
      capabilities: ["prompt:interactive_box", "output:polygon"],
    },
    route: (catalog) => imageTaskRoute(catalog, "annotating"),
    prepare: async (page) => {
      await page.getByTestId("workbench-stage").waitFor({ timeout: 10_000 });
      const button = page.getByTestId("tool-btn-smart-box");
      await button.waitFor({ state: "visible" });
      if (!(await button.isEnabled())) throw new Error("sam/interactive-toolbar: smart-box 被禁用");
      await button.click();
      await page.getByTestId("interactive-toolbar").waitFor({ state: "visible" });
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="interactive-toolbar"]', padding: 8 },
    target: "docs-site/user-guide/images/sam/interactive-toolbar.png",
  },
  {
    name: "sam/magic-box-toolbar",
    role: "annotator",
    fixture: {
      project: "image_demo",
      task: "annotating",
      backend: "image_interactive",
      capabilities: ["prompt:interactive_box", "output:bbox"],
    },
    route: (catalog) => imageTaskRoute(catalog, "annotating"),
    prepare: async (page) => {
      await page.getByTestId("workbench-stage").waitFor({ timeout: 10_000 });
      const button = page.getByTestId("tool-btn-magic-box");
      await button.waitFor({ state: "visible" });
      if (!(await button.isEnabled())) throw new Error("sam/magic-box-toolbar: magic-box 被禁用");
      await button.click();
      await page.getByTestId("interactive-toolbar").waitFor({ state: "visible" });
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="interactive-toolbar"]', padding: 8 },
    target: "docs-site/user-guide/images/sam/magic-box-toolbar.png",
  },
  {
    name: "sam/exemplar-output-mode",
    role: "annotator",
    fixture: {
      project: "image_demo",
      task: "annotating",
      backend: "image_interactive",
      capabilities: ["prompt:exemplar", "output:polygon"],
    },
    route: (catalog) => imageTaskRoute(catalog, "annotating"),
    prepare: async (page) => {
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 });
      const btn = page.getByTestId("tool-btn-exemplar");
      await btn.waitFor({ state: "visible" });
      if (!(await btn.isEnabled())) throw new Error("sam/exemplar-output-mode: exemplar 被禁用");
      await btn.click({ timeout: 4000 });
      await page.waitForSelector('[data-testid="exemplar-output-mode"]', { timeout: 3000 });
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[data-testid="interactive-toolbar"]', padding: 8 },
    annotate: [
      { selector: '[data-testid="exemplar-output-mode"]', style: "rect-red", label: "输出形态" },
    ],
    target: "docs-site/user-guide/images/sam/exemplar-output-mode.png",
  },
  {
    name: "sam/ai-inspector-panel",
    role: "admin",
    // Topbar「AI 单题」→ AIPredictionPopover（悬浮 AI 面板：置信度阈值滑块 + 单图预标）
    fixture: {
      project: "image_demo",
      task: "predicted",
      backend: "image_interactive",
      capabilities: ["task:interactive_seg"],
    },
    route: (catalog) => imageTaskRoute(catalog, "predicted"),
    prepare: async (page) => {
      await page.waitForSelector('[data-testid="workbench-stage"]', { timeout: 5000 });
      await page.waitForTimeout(300);
      const aiBtn = page.getByTestId("workbench-ai-single");
      await aiBtn.click({ timeout: 4000 });
      await page.waitForSelector('[data-testid="ai-prediction-popover"]', { timeout: 3000 });
      await page.waitForTimeout(300);
    },
    capture: { kind: "locator", selector: '[data-testid="ai-prediction-popover"]', padding: 8 },
    target: "docs-site/user-guide/images/sam/ai-inspector-panel.png",
  },
];
