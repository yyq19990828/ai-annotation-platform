import type { DefaultTheme } from "vitepress";

export const opsSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "部署与运维",
    items: [
      { text: "概览", link: "/ops/" },
      { text: "升级指南", link: "/ops/upgrade-guide" },
    ],
  },
  {
    text: "部署",
    items: [
      { text: "部署总览", link: "/ops/deploy/" },
      { text: "开发部署（本地）", link: "/ops/deploy/development" },
      { text: "生产部署（Docker Compose）", link: "/ops/deploy/docker-compose" },
      { text: "端口暴露与网络安全", link: "/ops/deploy/network-security" },
    ],
  },
  {
    text: "可观测性",
    items: [{ text: "监控与告警", link: "/ops/observability/" }],
  },
  {
    text: "安全",
    items: [{ text: "安全模型", link: "/ops/security/" }],
  },
  {
    text: "Runbooks",
    collapsed: true,
    items: [
      { text: "Celery Worker 卡死", link: "/ops/runbooks/celery-worker-stuck" },
      { text: "GPU 显存仲裁验收", link: "/ops/runbooks/gpu-arbitration-acceptance" },
      { text: "ML Backend 不可用", link: "/ops/runbooks/ml-backend-down" },
      { text: "视频帧服务", link: "/ops/runbooks/video-frame-service" },
      { text: "PG 连接池耗尽", link: "/ops/runbooks/postgres-connection-pool-exhausted" },
    ],
  },
];
