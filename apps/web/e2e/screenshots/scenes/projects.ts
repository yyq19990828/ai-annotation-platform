import type { ScreenshotScene } from "./_types";

export const PROJECT_SCENES: ScreenshotScene[] = [
  {
    name: "projects/create-entry",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
    // 箭头指向「新建项目」按钮
    annotate: [
      { selector: '[data-testid="new-project-btn"]', style: "arrow", label: "新建项目" },
    ],
    matrix: { themes: ["light", "dark"] },
    target: "docs-site/user-guide/images/projects/create-entry.png",
  },
  {
    name: "projects/wizard-steps",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const newBtn = page.getByRole("button", { name: /新建项目|新建/ }).first();
      if (await newBtn.count()) {
        await newBtn.click();
        await page.waitForTimeout(300);
      }
    },
    capture: { kind: "locator", selector: '[data-testid="project-wizard"]', padding: 0 },
    target: "docs-site/user-guide/images/projects/wizard-steps.png",
  },
  // ── mockState 示例场景 ────────────────────────────────────────────
  {
    name: "projects/empty-state",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
    mockState: "empty",
    target: "docs-site/user-guide/images/projects/empty-state.png",
  },
  {
    name: "projects/error-state",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      // 等待错误提示渲染
      await page.waitForTimeout(500);
    },
    mockState: "error",
    target: "docs-site/user-guide/images/projects/error-state.png",
  },
];
