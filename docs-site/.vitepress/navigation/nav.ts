import type { DefaultTheme } from "vitepress";

// Four documentation domains; the homepage styles the final quickstart action as a CTA.
// Changelog / Roadmap 收进「更多」次级组；GitHub 由 themeConfig.socialLinks 承载。
export const nav: DefaultTheme.NavItem[] = [
  { text: "使用指南", link: "/user-guide/", activeMatch: "^/user-guide/" },
  { text: "开发文档", link: "/dev/", activeMatch: "^/dev/" },
  { text: "API", link: "/api/", activeMatch: "^/api/" },
  { text: "部署运维", link: "/ops/", activeMatch: "^/ops/" },
  {
    text: "更多",
    items: [
      { text: "更新日志", link: "/changelog/" },
      { text: "路线图", link: "/roadmap/" },
    ],
  },
  { text: "快速开始", link: "/user-guide/getting-started" },
];
