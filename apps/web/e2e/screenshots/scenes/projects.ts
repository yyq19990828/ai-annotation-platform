import type { Page } from "@playwright/test";
import type { ScreenshotScene } from "./_types";

async function waitForAdminProjectsDashboard(page: Page) {
  await page.getByRole("heading", { name: "项目管理" }).waitFor({ timeout: 10_000 });
  await page.getByRole("heading", { name: "全部项目" }).waitFor({ timeout: 10_000 });
}

export const PROJECT_SCENES: ScreenshotScene[] = [
  {
    name: "projects/create-entry",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      await waitForAdminProjectsDashboard(page);
    },
    // 箭头指向「新建项目」按钮
    annotate: [
      { selector: '[data-testid="new-project-btn"]', style: "rect-blue" },
    ],
    matrix: { themes: ["light", "dark"] },
    target: "docs-site/user-guide/images/projects/create-entry.png",
  },
  {
    name: "projects/wizard-steps",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      await waitForAdminProjectsDashboard(page);
      const newBtn = page.getByRole("button", { name: /新建项目|新建/ }).first();
      if (await newBtn.count()) {
        await newBtn.click();
        await page.locator('[data-testid="project-wizard"]').waitFor({ timeout: 10_000 });
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
      await waitForAdminProjectsDashboard(page);
      await page.getByText("没有匹配的项目").waitFor({ timeout: 10_000 });
    },
    mockState: "empty",
    target: "docs-site/user-guide/images/projects/empty-state.png",
  },
  {
    name: "projects/error-state",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "项目管理" }).waitFor({ timeout: 10_000 });
      await page.getByText("HTTP 500").first().waitFor({ timeout: 10_000 });
      await page.getByText("没有匹配的项目").waitFor({ timeout: 10_000 });
    },
    mockState: "error",
    target: "docs-site/user-guide/images/projects/error-state.png",
  },
];
