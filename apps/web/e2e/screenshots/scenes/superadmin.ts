import type { ScreenshotScene } from "./_types";

// 平台管理页（super_admin 视角）：用户 / BUG 反馈 / 离线分析 / 系统健康 / 模型市场 / 审计 / 通知面板。
// 路由见 App.tsx：/users /bugs /admin/analytics /admin/health /model-market /audit。
// 本地 DB 已有 52 条 bug_reports、4w+ audit_logs，故列表 / 详情有内容可截。
// platform.ts 已覆盖 /users「角色」tab（权限矩阵）与侧边栏总览，这里补「成员」列表 + 邀请 modal。

export const SUPERADMIN_SCENES: ScreenshotScene[] = [
  {
    name: "superadmin/users/list",
    role: "admin",
    route: () => "/users",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300); // 默认「成员」tab：4 张统计卡 + 成员表
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/users/list.png",
  },
  {
    name: "superadmin/users/invite-modal",
    role: "admin",
    route: () => "/users",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const inviteBtn = page.getByRole("button", { name: /邀请成员/ }).first();
      if (await inviteBtn.count()) {
        await inviteBtn.click();
        await page.waitForTimeout(350);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/superadmin/users/invite-modal.png",
  },
  {
    name: "superadmin/bugs/list",
    role: "admin",
    route: () => "/bugs",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400); // 筛选栏 + 列表表格
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/bugs/list.png",
  },
  {
    name: "superadmin/bugs/detail-panel",
    role: "admin",
    route: () => "/bugs",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 点首行 → 右侧详情面板（布局切到 layoutWithDetail）
      const firstRow = page.locator("tbody tr").first();
      if (await firstRow.count()) {
        await firstRow.click();
        await page.waitForTimeout(500);
      }
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/bugs/detail-panel.png",
  },
  {
    name: "superadmin/analytics/overview",
    role: "admin",
    route: () => "/admin/analytics",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(800); // recharts 渲染：时间范围下拉 + 4 面板
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/analytics/overview.png",
  },
  {
    name: "superadmin/analytics/heatmap",
    role: "admin",
    route: () => "/admin/analytics",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="panel-heatmap"]', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
    },
    capture: { kind: "locator", selector: '[data-testid="panel-heatmap"]', padding: 0 },
    target: "docs-site/user-guide/images/superadmin/analytics/heatmap.png",
  },
  {
    name: "superadmin/system-monitoring/health-panel",
    role: "admin",
    route: () => "/admin/health",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600); // 组件卡 + Celery 队列表 + Workers
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/system-monitoring/health-panel.png",
  },
  {
    name: "superadmin/model-market/list",
    role: "admin",
    route: () => "/model-market",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500); // 3 张统计卡 + 3 tab（能力目录/运行时观测/注册管理）
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/model-market/list.png",
  },
  {
    name: "superadmin/audit-logs/filter-bar",
    role: "admin",
    route: () => "/audit",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500); // 筛选栏（scope/action/target）+ 分组列表
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/audit-logs/filter-bar.png",
  },
  {
    name: "notifications/panel-overview",
    role: "admin",
    route: () => "/dashboard",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 顶栏铃铛按钮（title="通知"）→ 展开 NotificationsPopover
      const bell = page.getByRole("button", { name: "通知", exact: true }).first();
      if (await bell.count()) {
        await bell.click();
        await page.waitForTimeout(400);
      }
      await page.waitForSelector('[class*="panelContent"]', { timeout: 3000 }).catch(() => {});
    },
    capture: { kind: "locator", selector: '[class*="panelContent"]', padding: 0 },
    target: "docs-site/user-guide/images/notifications/panel-overview.png",
  },
];
