import type { DefaultTheme } from "vitepress";

// 顶栏收敛为四个主域 + 高优先级「快速开始」CTA（末位，样式见 docs-theme.css）。
// Changelog / Roadmap 收进「更多」次级组；GitHub 由 themeConfig.socialLinks 承载。
export const nav: DefaultTheme.NavItem[] = [
  { text: "使用平台", link: "/user-guide/", activeMatch: "^/user-guide/" },
  { text: "开发者", link: "/dev/", activeMatch: "^/dev/" },
  { text: "API", link: "/api/", activeMatch: "^/api/" },
  { text: "部署运维", link: "/ops/", activeMatch: "^/ops/" },
  {
    text: "更多",
    items: [
      { text: "更新日志", link: "/changelog/" },
      { text: "Roadmap", link: "/roadmap/" },
    ],
  },
  { text: "快速开始 ↗", link: "/user-guide/getting-started" },
];
