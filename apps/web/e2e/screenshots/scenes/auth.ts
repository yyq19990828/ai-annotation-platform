import type { ScreenshotScene } from "./_types";

export const AUTH_SCENES: ScreenshotScene[] = [
  {
    name: "getting-started/login",
    role: "admin",
    route: () => "/login",
    prepare: async (page) => {
      await page.evaluate(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("auth-storage");
      });
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
    },
    // 登录页是平台入口，对暗色 + 移动端都出图
    matrix: {
      themes: ["light", "dark"],
      viewports: ["desktop", "mobile"],
    },
    target: "docs-site/user-guide/images/getting-started/login.png",
  },
  {
    name: "getting-started/forgot-password",
    role: "admin",
    route: () => "/forgot-password",
    prepare: async (page) => {
      await page.evaluate(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("auth-storage");
      });
      await page.goto("/forgot-password");
      await page.waitForLoadState("networkidle");
    },
    target: "docs-site/user-guide/images/getting-started/forgot-password.png",
  },
];
