import type { ScreenshotScene } from "./_types";

// 平台级页面截图：侧边栏导航总览 / 角色 Dashboard。
// 均为 super_admin 视角（seed peek 返回的 admin 即 super_admin），纯导航 + 局部交互，不依赖工作台。

export const PLATFORM_SCENES: ScreenshotScene[] = [
  {
    name: "platform/nav-overview",
    role: "admin",
    route: () => "/dashboard",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.waitForSelector("aside", { timeout: 3000 });
    },
    // 侧边栏整体（含分区标签 + 导航项 + 角标）
    capture: { kind: "locator", selector: "aside", padding: 0 },
    target: "docs-site/user-guide/images/getting-started/platform-nav-overview.png",
  },
  {
    name: "platform/role-dashboard-overview",
    role: "admin",
    route: () => "/dashboard",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // AdminDashboard 主容器（super_admin → 平台概览）
      await page.waitForTimeout(400);
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/getting-started/role-dashboard-overview.png",
  },
];
