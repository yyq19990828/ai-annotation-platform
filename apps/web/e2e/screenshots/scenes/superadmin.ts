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
  // ── Tier A 扩展（v0.15.26）：用户 / 审计 / 失败预测 / 健康 / 模型注册 / 模板 / BUG ──
  {
    name: "superadmin/users/edit-modal",
    role: "admin",
    route: () => "/users",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      // 成员行编辑按钮（title="编辑成员"）
      const editBtn = page.getByRole("button", { name: /编辑成员|编辑/ }).first();
      if (await editBtn.count()) {
        await editBtn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/superadmin/users/edit-modal.png",
  },
  {
    name: "superadmin/users/groups-tab",
    role: "admin",
    route: () => "/users",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 切「数据组」tab（组创建 + 成员添加）
      const tab = page.getByRole("button", { name: /数据组|用户组/ }).first();
      if (await tab.count()) {
        await tab.click().catch(() => {});
        await page.waitForTimeout(400);
      }
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/users/groups-tab.png",
  },
  {
    name: "superadmin/users/permission-matrix",
    role: "admin",
    route: () => "/users",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 切「角色」tab 展示权限矩阵预览
      const tab = page.getByRole("button", { name: /角色/ }).first();
      if (await tab.count()) {
        await tab.click().catch(() => {});
        await page.waitForTimeout(400);
      }
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/users/permission-matrix.png",
  },
  {
    name: "superadmin/audit-logs/detail-modal",
    role: "admin",
    route: () => "/audit",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      // 首行「详情」按钮 → detail_json Modal
      const detailBtn = page.getByRole("button", { name: /详情/ }).first();
      if (await detailBtn.count()) {
        await detailBtn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/superadmin/audit-logs/detail-modal.png",
  },
  {
    name: "superadmin/failed-predictions/list",
    role: "admin",
    route: () => "/ai-pre/jobs?status=failed",
    prepare: async (page) => {
      // mock 全 failed job，展示失败筛选列表（重试/放弃/显示已放弃 toggle）
      await page.route("**/api/v1/admin/preannotate-jobs*", async (route) => {
        const errors = ["model timeout", "backend connection refused", "CUDA out of memory"];
        const items = Array.from({ length: 5 }, (_, i) => ({
          id: `mock-fail-${i}-${"0".repeat(28)}`.slice(0, 36),
          project_id: `mock-proj-${i}-${"0".repeat(26)}`.slice(0, 36),
          project_name: `演示项目 ${i + 1}`,
          project_display_id: `P-${100 + i}`,
          batch_id: null,
          ml_backend_id: null,
          prompt: "person, car, truck",
          output_mode: "manual",
          status: "failed",
          total_tasks: 80 + i * 20,
          success_count: 80 + i * 20 - 3,
          failed_count: 3,
          started_at: new Date(Date.now() - i * 3600_000).toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 60_000 + i * 12_000,
          total_cost: null,
          error_message: errors[i % errors.length],
        }));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items, next_cursor: null }),
        });
      });
      await page.goto("/ai-pre/jobs?status=failed");
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/failed-predictions/list.png",
  },
  {
    name: "superadmin/system-monitoring/workers-table",
    role: "admin",
    route: () => "/admin/health",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
    },
    // 单独截 Workers 心跳表（含 Worker / Heartbeat / Pool / Status 表头）
    capture: { kind: "locator", selector: 'table:has-text("Heartbeat")', padding: 8 },
    target: "docs-site/user-guide/images/superadmin/system-monitoring/workers-table.png",
  },
  {
    name: "superadmin/ml-backend/register-form",
    role: "admin",
    route: () => "/model-market",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 切「注册管理」tab
      const tab = page.getByRole("button", { name: /注册管理/ }).first();
      if (await tab.count()) {
        await tab.click().catch(() => {});
        await page.waitForTimeout(400);
      }
      // 点「注册」按钮打开表单
      const reg = page.getByRole("button", { name: /注册\s*backend|注册\s*ML|^注册$|注册/ }).first();
      if (await reg.count()) {
        await reg.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
    },
    capture: { kind: "locator", selector: '[role="dialog"]', padding: 0 },
    target: "docs-site/user-guide/images/superadmin/ml-backend/register-form.png",
  },
  {
    name: "superadmin/public-templates/templates-list",
    role: "admin",
    route: () => "/project-templates",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      // 切「全部」tab 展示四 tab + scope chip + usage_count
      const allTab = page.getByRole("button", { name: /^全部$|全部/ }).first();
      if (await allTab.count()) {
        await allTab.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/public-templates/templates-list.png",
  },
  {
    name: "superadmin/bugs/status-transitions",
    role: "admin",
    route: () => "/bugs",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 点首行打开详情面板（状态切换按钮组所在）
      const firstRow = page.locator("tbody tr").first();
      if (await firstRow.count()) {
        await firstRow.click().catch(() => {});
        await page.waitForTimeout(500);
      }
      await page.waitForLoadState("networkidle");
    },
    // 红框高亮状态切换按钮组（含关闭后重开徽标）
    annotate: [{ selector: '[class*="statusActions"]', style: "rect-red", label: "状态切换" }],
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/superadmin/bugs/status-transitions.png",
  },
];
