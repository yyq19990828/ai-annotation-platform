/**
 * v0.8.7 F4 · 截图自动化 14 场景配置。
 *
 * 与 docs-site/user-guide/IMAGE_CHECKLIST.md 一一对应。
 * keypoint 两张（human-pose / hand）暂跳过——非 image-det 工作台尚未实装，
 * 等 v0.10.x SAM 3 / 后续接入时一并补。
 *
 * 字段：
 *   - name: 场景名（用于 test 标题与 testid）
 *   - role: 'admin' | 'annotator' | 'reviewer'
 *   - prepare: 进入路由前的准备（advance_task / 路由 / 元素点击）
 *   - target: 输出 PNG 路径（相对仓库根）
 *   - viewport: 截图视口
 */
import type { Page } from "@playwright/test";
import type { SeedData } from "../fixtures/seed";

export type Role = "admin" | "annotator" | "reviewer";

export interface ScreenshotScene {
  name: string;
  role: Role;
  /** 进入页面后再做的准备步骤（高亮元素 / 打开 modal / 切 tab 等）。 */
  prepare?: (page: Page, data: SeedData) => Promise<void>;
  /** 路由路径，可基于 SeedData 动态拼。 */
  route: (data: SeedData) => string;
  /** 输出 PNG 相对路径（相对仓库根 docs-site/user-guide/...）。 */
  target: string;
  /** 视口尺寸；默认 1440×900。 */
  viewport?: { width: number; height: number };
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export const SCENES: ScreenshotScene[] = [
  // Getting Started ──────────────────────────────────────────────
  {
    name: "getting-started/login",
    role: "admin", // 登录页本身不需要登录态；用 admin token 后退到登录页
    route: () => "/login",
    target: "docs-site/user-guide/images/getting-started/login.png",
    prepare: async (page) => {
      // 强制注销，确保截图为登录态
      await page.evaluate(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("auth-storage");
      });
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
    },
    viewport: DEFAULT_VIEWPORT,
  },
  {
    name: "getting-started/forgot-password",
    role: "admin",
    route: () => "/forgot-password",
    target: "docs-site/user-guide/images/getting-started/forgot-password.png",
    prepare: async (page) => {
      await page.evaluate(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("auth-storage");
      });
      await page.goto("/forgot-password");
      await page.waitForLoadState("networkidle");
    },
  },
  // Workbench / Bbox ─────────────────────────────────────────────
  {
    name: "bbox/toolbar",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    target: "docs-site/user-guide/images/bbox/toolbar.png",
    prepare: async (page, d) => {
      // 准备: task[0] 分给 annotator
      await page.waitForLoadState("networkidle");
      void d;
    },
  },
  {
    name: "bbox/iou",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    target: "docs-site/user-guide/images/bbox/iou.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 真正含 IoU 重叠双框的状态需手动准备数据；自动化只截工作台基线，
      // maintainer 后续在数据准备好后人工抓帧覆盖。
    },
  },
  {
    name: "bbox/bulk-edit",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    target: "docs-site/user-guide/images/bbox/bulk-edit.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
  },
  // Workbench / Polygon ──────────────────────────────────────────
  {
    name: "polygon/vertex-edit",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    target: "docs-site/user-guide/images/polygon/vertex-edit.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 切 polygon 工具
      const polygonBtn = page.getByTestId("tool-btn-polygon");
      if (await polygonBtn.count()) await polygonBtn.click();
    },
  },
  {
    name: "polygon/close-hint",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    target: "docs-site/user-guide/images/polygon/close-hint.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const polygonBtn = page.getByTestId("tool-btn-polygon");
      if (await polygonBtn.count()) await polygonBtn.click();
    },
  },
  // Projects ────────────────────────────────────────────────────
  {
    name: "projects/create-entry",
    role: "admin",
    route: () => "/projects",
    target: "docs-site/user-guide/images/projects/create-entry.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
  },
  {
    name: "projects/wizard-steps",
    role: "admin",
    route: () => "/projects",
    target: "docs-site/user-guide/images/projects/wizard-steps.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const newBtn = page
        .getByRole("button", { name: /新建项目|新建/ })
        .first();
      if (await newBtn.count()) {
        await newBtn.click();
        await page.waitForTimeout(300); // 让 wizard 第一步渲染稳定
      }
    },
  },
  // Review ──────────────────────────────────────────────────────
  {
    name: "review/workbench",
    role: "reviewer",
    route: (d) => `/review?task=${d.task_ids[0]}`,
    target: "docs-site/user-guide/images/review/workbench.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
    },
  },
  {
    name: "review/reject-form",
    role: "reviewer",
    route: (d) => `/review?task=${d.task_ids[0]}`,
    target: "docs-site/user-guide/images/review/reject-form.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const rejectBtn = page.getByTestId("review-reject");
      if (await rejectBtn.count()) {
        await rejectBtn.click();
        await page.waitForTimeout(200); // modal 渲染
      }
    },
  },
  // Export ──────────────────────────────────────────────────────
  {
    name: "export/format-select",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/settings`,
    target: "docs-site/user-guide/images/export/format-select.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const exportTab = page.getByTestId("settings-tab-export");
      if (await exportTab.count()) await exportTab.click();
    },
  },
  {
    name: "export/progress",
    role: "admin",
    route: (d) => `/projects/${d.project_id}/settings`,
    target: "docs-site/user-guide/images/export/progress.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const exportTab = page.getByTestId("settings-tab-export");
      if (await exportTab.count()) await exportTab.click();
      // 真正进度条需服务端跑导出；自动化只截入口卡片，maintainer 后续覆盖。
    },
  },
  // SAM 子工具栏 + text 三模式（v0.9.4 phase 2）─────────────────────
  {
    name: "sam/subtoolbar",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    target: "docs-site/user-guide/images/sam/subtoolbar.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 按 S 进 SAM 模式 → ToolDock 子工具栏 [点 / 框 / 文本] 浮出.
      await page.keyboard.press("s");
      await page.waitForTimeout(150);
      // 等 sam-subtoolbar 元素出现; 截图聚焦左侧工具区.
      await page.waitForSelector('[data-testid="sam-subtoolbar"]', { timeout: 2000 });
    },
  },
  {
    name: "sam/text-three-modes",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    target: "docs-site/user-guide/images/sam/text-three-modes.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 按 S 两次到 text 子工具 (point → bbox → text), 让 SamTextPanel 浮出.
      await page.keyboard.press("s"); await page.waitForTimeout(80); // 进 sam·point
      await page.keyboard.press("s"); await page.waitForTimeout(80); // 切 bbox
      await page.keyboard.press("s"); await page.waitForTimeout(80); // 切 text
      await page.waitForSelector('[data-testid="sam-text-output-mode"]', { timeout: 2000 });
      // maintainer 实跑时可分别点 box/mask/both 各截一张拼成对比图; 此 scene 只截当前默认状态.
    },
  },
  // ── v0.9.7 · AIPreAnnotate 信息架构重构 + Wizard backend dropdown ──────
  {
    name: "ai-pre/stepper",
    role: "admin",
    route: () => "/ai-pre",
    target: "docs-site/user-guide/images/projects/ai-pre-stepper.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 默认 stepper 4 步全 pending; 截入空状态展示信息架构. maintainer 实跑时可
      // 选完项目+batch 让 step 1 变 complete 再截一张「进行中」状态.
    },
  },
  {
    name: "ai-pre/history-search",
    role: "admin",
    route: () => "/ai-pre",
    target: "docs-site/user-guide/images/projects/ai-pre-history-search.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // maintainer 需在 seed 中预置 5+ pre_annotated 批次 (apps/api/scripts/seed.py)
      // 才能展示搜索框 + 列排序; 当前空 seed 仅截「无历史」空状态.
    },
  },
  {
    name: "ai-pre/empty-alias",
    role: "admin",
    route: () => "/ai-pre",
    target: "docs-site/user-guide/images/projects/ai-pre-empty-alias.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // maintainer 需 seed 一个项目 ai_enabled=true 但所有类别无 alias, 让
      // PromptComposer 渲染「前往项目设置」引导卡.
    },
  },
  {
    name: "wizard/step4-backend",
    role: "admin",
    route: () => "/projects",
    target: "docs-site/user-guide/images/projects/wizard-step4-backend.png",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 点击「新建项目」按钮 → 走到 step 4. maintainer 实跑时:
      // 1) seed 至少一个已注册 backend (RegisteredBackendsTab 注册过的)
      // 2) 点击「新建项目」, 填 step 1-3, 进 step 4 勾启用 AI
      // 3) 等 BackendSourceSelect dropdown 出现可选项.
    },
  },
];
