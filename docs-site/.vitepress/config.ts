import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ADR 侧边栏由 docs-site/scripts/mirror-adr.mjs 在 prebuild/predev 阶段生成。
// 若文件缺失（例如刚 clone 还未跑 prebuild），降级为空数组让 VitePress 仍能启动。
const __here = dirname(fileURLToPath(import.meta.url));
type SidebarItem = { text: string; link: string };

function loadSidebar(rel: string): SidebarItem[] {
  const p = resolve(__here, rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SidebarItem[]) : [];
}

const adrSidebarItems = loadSidebar("../dev/adr/sidebar.generated.json");
const changelogSidebarItems = loadSidebar("../changelog/sidebar.generated.json");
const roadmapSidebarItems = loadSidebar("../roadmap/sidebar.generated.json");

export default withMermaid(defineConfig({
  title: "AI Annotation Platform",
  description: "标注平台文档（用户 / 开发 / API）",
  lang: "zh-CN",
  base: process.env.DOCS_BASE ?? "/",
  cleanUrls: true,
  lastUpdated: true,
  // 允许指向本地开发服务器的链接，构建期不当 dead link
  ignoreDeadLinks: [/^https?:\/\/localhost(:\d+)?(\/|$)/],

  // mermaid 11.x 的 chunk 直接 import `dayjs/dayjs.min.js`（UMD 文件），Vite 当 ESM
  // 解析失败 → "does not provide an export named 'default'"。alias 指向 ESM 入口。
  vite: {
    resolve: {
      alias: [{ find: /^dayjs\/dayjs\.min\.js$/, replacement: "dayjs/esm/index.js" }],
    },
    optimizeDeps: {
      include: ["dayjs/esm/index.js", "@braintree/sanitize-url", "debug"],
    },
  },

  themeConfig: {
    nav: [
      { text: "用户手册", link: "/user-guide/" },
      { text: "开发文档", link: "/dev/" },
      { text: "API 文档", link: "/api/" },
      { text: "更新日志", link: "/changelog/" },
      { text: "Roadmap", link: "/roadmap/" },
    ],

    sidebar: {
      "/user-guide/": [
        {
          text: "入门",
          items: [
            { text: "概述", link: "/user-guide/" },
            { text: "快速开始", link: "/user-guide/getting-started" },
          ],
        },
        {
          text: "标注工作台",
          items: [
            { text: "界面与快捷键", link: "/user-guide/workbench/" },
            { text: "Bbox 标注", link: "/user-guide/workbench/bbox" },
            { text: "Polygon 标注", link: "/user-guide/workbench/polygon" },
            { text: "关键点标注", link: "/user-guide/workbench/keypoint" },
            { text: "SAM 智能工具", link: "/user-guide/workbench/sam-tool" },
          ],
        },
        {
          text: "项目与批次",
          items: [
            { text: "创建项目", link: "/user-guide/projects/" },
            { text: "批次与分配", link: "/user-guide/projects/batch" },
          ],
        },
        {
          text: "审核",
          items: [{ text: "审核流程", link: "/user-guide/review/" }],
        },
        {
          text: "导出",
          items: [{ text: "数据导出格式", link: "/user-guide/export/" }],
        },
        {
          text: "超级管理员",
          collapsed: true,
          items: [
            { text: "概览", link: "/user-guide/superadmin/" },
            { text: "ML Backend 注册", link: "/user-guide/superadmin/ml-backend-registry" },
            { text: "模型市场", link: "/user-guide/superadmin/model-market" },
            { text: "失败预测排查", link: "/user-guide/superadmin/failed-predictions" },
            { text: "审计日志", link: "/user-guide/superadmin/audit-logs" },
            { text: "系统监控", link: "/user-guide/superadmin/system-monitoring" },
          ],
        },
        {
          text: "其他",
          items: [{ text: "FAQ", link: "/user-guide/faq" }],
        },
      ],

      "/dev/": [
        {
          text: "起步",
          items: [
            { text: "概览", link: "/dev/" },
            { text: "本地开发", link: "/dev/local-dev" },
            { text: "测试指南", link: "/dev/testing" },
            { text: "约定与规范", link: "/dev/conventions" },
            { text: "发布流程", link: "/dev/release" },
          ],
        },
        {
          text: "架构",
          items: [
            { text: "系统全景", link: "/dev/architecture/overview" },
            { text: "后端基础设施（容器）", link: "/dev/architecture/backend-infrastructure" },
            { text: "后端分层", link: "/dev/architecture/backend-layers" },
            { text: "前端分层", link: "/dev/architecture/frontend-layers" },
            { text: "数据流", link: "/dev/architecture/data-flow" },
            { text: "AI 模型集成", link: "/dev/architecture/ai-models" },
            { text: "API Schema 边界", link: "/dev/architecture/api-schema-boundary" },
            { text: "预标注流水线", link: "/dev/architecture/prediction-pipeline" },
            { text: "部署拓扑", link: "/dev/architecture/deployment-topology" },
          ],
        },
        {
          text: "部署与协议",
          items: [
            { text: "部署指南", link: "/dev/deploy" },
            { text: "安全模型", link: "/dev/security" },
            { text: "可观测性 / 监控", link: "/dev/monitoring" },
            { text: "ML Backend 协议", link: "/dev/ml-backend-protocol" },
            { text: "WebSocket 协议", link: "/dev/ws-protocol" },
          ],
        },
        {
          text: "How-to",
          items: [
            { text: "新增 API 端点", link: "/dev/how-to/add-api-endpoint" },
            { text: "新增前端页面", link: "/dev/how-to/add-page" },
            { text: "Alembic 迁移", link: "/dev/how-to/add-migration" },
            { text: "调试 Celery", link: "/dev/how-to/debug-celery" },
          ],
        },
        {
          text: "故障排查 / 踩坑",
          collapsed: true,
          items: [
            { text: "总览与速查表", link: "/dev/troubleshooting/" },
            { text: "Docker rebuild vs restart", link: "/dev/troubleshooting/docker-rebuild-vs-restart" },
            { text: "容器网络与 loopback", link: "/dev/troubleshooting/container-networking" },
            { text: "Prediction Schema 适配器", link: "/dev/troubleshooting/schema-adapter-pitfalls" },
            { text: "Dev 数据保护", link: "/dev/troubleshooting/dev-data-preservation" },
            { text: "React useState TDZ", link: "/dev/troubleshooting/react-tdz-trap" },
            { text: "环境变量与 config 路径", link: "/dev/troubleshooting/env-and-config-paths" },
            { text: "CI 服务依赖踩坑", link: "/dev/troubleshooting/ci-flaky-services" },
          ],
        },
        {
          text: "ADR（架构决策）",
          collapsed: true,
          items: adrSidebarItems,
        },
      ],

      "/changelog/": changelogSidebarItems,
      "/roadmap/": roadmapSidebarItems,

      "/api/": [
        { text: "API 总览", link: "/api/" },
        {
          text: "按资源域指南",
          items: [
            { text: "认证", link: "/api/guides/auth" },
            { text: "项目", link: "/api/guides/projects" },
            { text: "任务与标注", link: "/api/guides/tasks-and-annotations" },
            { text: "Predictions / Jobs", link: "/api/guides/predictions" },
            { text: "ML Backend", link: "/api/guides/ml-backend" },
            { text: "WebSocket", link: "/api/guides/websocket" },
            { text: "导出", link: "/api/guides/export" },
            { text: "路由索引（自动生成）", link: "/api/guides/_routes.generated" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/yyq19990828/ai-annotation-platform" },
    ],

    search: { provider: "local" },

    footer: {
      message: "Released under the MIT License.",
      copyright: "© 2026 AI Annotation Platform",
    },

    editLink: {
      pattern:
        "https://github.com/yyq19990828/ai-annotation-platform/edit/main/docs-site/:path",
      text: "在 GitHub 编辑此页",
    },
  },
}));
