import type { DefaultTheme } from "vitepress";

export const apiSidebar: DefaultTheme.SidebarItem[] = [
  { text: "API 总览", link: "/api/" },
  {
    text: "指南",
    items: [
      { text: "认证", link: "/api/guides/auth" },
      { text: "项目", link: "/api/guides/projects" },
      { text: "任务与标注", link: "/api/guides/tasks-and-annotations" },
      { text: "Predictions / Jobs", link: "/api/guides/predictions" },
      { text: "异步任务", link: "/api/guides/async-jobs" },
      { text: "Video Tracker Jobs", link: "/api/guides/video-tracker-jobs" },
      { text: "ML Backend", link: "/api/guides/ml-backend" },
      { text: "预测导入", link: "/api/guides/import" },
      { text: "WebSocket", link: "/api/guides/websocket" },
      { text: "导出", link: "/api/guides/export" },
      { text: "存储连接器", link: "/api/guides/storage-connections" },
      { text: "路由索引（自动生成）", link: "/api/guides/_routes.generated" },
    ],
  },
];
