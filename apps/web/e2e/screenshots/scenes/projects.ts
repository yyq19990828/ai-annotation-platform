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
  // ── Tier A 扩展（v0.15.26）：项目设置 / 数据管理 / 模板库 / 预测导入导出 ──
  {
    name: "projects/tool-units-panel",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/settings?section=classes`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500); // 类别面板 + 工具单位 tab 渲染
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/projects/tool-units-panel.png",
  },
  {
    name: "projects/batch-status-list",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/settings?section=batches`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500); // 批次列表彩色状态徽标
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/projects/batch-status-list.png",
  },
  {
    name: "projects/data-manager-overview",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/data-manager`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600); // 视图列表 + 过滤条件栏 + 任务表格
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/projects/data-manager-overview.png",
  },
  {
    name: "projects/data-manager-filter-rules",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/data-manager`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      // 展开/新增一条过滤条件行（字段选择器展开）
      const addRule = page.getByRole("button", { name: /\+\s*条件|添加条件|新增条件/ }).first();
      if (await addRule.count()) {
        await addRule.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/projects/data-manager-filter-rules.png",
  },
  {
    name: "projects/template-library-overview",
    role: "admin",
    route: () => "/project-templates",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500); // 管理组入口 + 新建/导出按钮 + 四 tab + 卡片网格
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/projects/template-library-overview.png",
  },
  {
    name: "projects/ml-backends/register-form",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/settings?section=ml-backends`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      const reg = page.getByRole("button", { name: /注册\s*backend|注册\s*ML|注册/ }).first();
      if (await reg.count()) {
        await reg.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/projects/ml-backends/register-form.png",
  },
  {
    name: "projects/ai-pre-config-panel",
    role: "admin",
    route: () => "/ai-pre",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const card = page.getByText(/2D图片标注测试|P-0001/).first();
      if (await card.count()) {
        await card.click();
        await page.waitForTimeout(400);
      }
      await page
        .getByText(/待预标批次|批跑预标|跑预标/)
        .first()
        .waitFor({ timeout: 3000 })
        .catch(() => {});
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/projects/ai-pre-config-panel.png",
  },
  {
    name: "projects/prediction-import-wizard",
    role: "admin",
    route: () => "/ai-pre",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const card = page.getByText(/2D图片标注测试|P-0001/).first();
      if (await card.count()) {
        await card.click();
        await page.waitForTimeout(400);
      }
      const importBtn = page.getByRole("button", { name: /导入预测/ }).first();
      if (await importBtn.count()) {
        await importBtn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/projects/prediction-import-wizard.png",
  },
  {
    name: "projects/prediction-purge-modal",
    role: "admin",
    route: () => "/dashboard",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      // 项目卡片「更多操作」菜单 → 清理预测
      const menuBtn = page.getByRole("button", { name: /更多操作|更多|操作/ }).first();
      if (await menuBtn.count()) {
        await menuBtn.click().catch(() => {});
        await page.waitForTimeout(250);
      }
      const purge = page.getByRole("menuitem", { name: /清理预测/ }).first();
      if (await purge.count()) {
        await purge.click().catch(() => {});
      } else {
        await page.getByText(/清理预测/).first().click().catch(() => {});
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/projects/prediction-purge-modal.png",
  },
];
