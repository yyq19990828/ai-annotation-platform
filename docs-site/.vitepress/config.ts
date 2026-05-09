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
  ignoreDeadLinks: [
    /^https?:\/\/localhost(:\d+)?(\/|$)/,
    // ROADMAP / ADR mirror files contain relative links to source code files outside docs-site
    (url) => /\.(tsx?|py|json|ya?ml|sh|toml|Dockerfile\w*)$/.test(url),
    (url) => /\/(apps|infra)\//.test(url),
    (url) => /IMAGE_CHECKLIST/.test(url),
  ],

  // mermaid 11.x 的 chunk 直接 import `dayjs/dayjs.min.js`（UMD 文件），Vite 当 ESM
  // 解析失败 → "does not provide an export named 'default'"。alias 指向 ESM 入口。
  vite: {
    plugins: [
      // M4 · 把 apps/web/e2e/screenshots/outputs/manifest.json 暴露为虚拟模块
      // AutoImage.vue 通过 `import("virtual:screenshot-manifest")` 消费
      {
        name: "vite-plugin-screenshot-manifest",
        resolveId(id: string) {
          if (id === "virtual:screenshot-manifest") return "\0virtual:screenshot-manifest";
        },
        load(id: string) {
          if (id !== "\0virtual:screenshot-manifest") return;
          const manifestPath = resolve(__here, "../../apps/web/e2e/screenshots/outputs/manifest.json");
          try {
            const data = existsSync(manifestPath)
              ? JSON.parse(readFileSync(manifestPath, "utf8"))
              : {};
            return `export default ${JSON.stringify(data)}`;
          } catch {
            return "export default {}";
          }
        },
      },
    ],
    resolve: {
      alias: [{ find: /^dayjs\/dayjs\.min\.js$/, replacement: "dayjs/esm/index.js" }],
    },
    optimizeDeps: {
      include: ["dayjs/esm/index.js", "@braintree/sanitize-url", "debug"],
    },
  },

  themeConfig: {
    nav: [
      { text: "快速开始", link: "/user-guide/getting-started" },
      { text: "用户手册", link: "/user-guide/" },
      { text: "开发文档", link: "/dev/" },
      { text: "部署与运维", link: "/ops/" },
      { text: "API 文档", link: "/api/" },
      {
        text: "更新日志 / Roadmap",
        items: [
          { text: "更新日志", link: "/changelog/" },
          { text: "Roadmap", link: "/roadmap/" },
        ],
      },
    ],

    sidebar: {
      "/user-guide/": [
        {
          text: "入口",
          items: [
            { text: "概述", link: "/user-guide/" },
            { text: "平台概念与术语", link: "/user-guide/concepts" },
            { text: "快速开始", link: "/user-guide/getting-started" },
          ],
        },
        {
          text: "标注员",
          items: [
            { text: "工作台概览", link: "/user-guide/for-annotators/" },
            { text: "Bbox 标注", link: "/user-guide/for-annotators/bbox" },
            { text: "Polygon 标注", link: "/user-guide/for-annotators/polygon" },
            { text: "关键点标注", link: "/user-guide/for-annotators/keypoint" },
            { text: "SAM 智能工具", link: "/user-guide/for-annotators/sam-tool" },
          ],
        },
        {
          text: "项目管理员",
          collapsed: true,
          items: [
            { text: "项目管理", link: "/user-guide/for-project-admins/" },
            { text: "批次与分配", link: "/user-guide/for-project-admins/batch" },
            { text: "AI 预标注", link: "/user-guide/for-project-admins/ai-preannotate" },
          ],
        },
        {
          text: "审核员",
          items: [
            { text: "审核流程", link: "/user-guide/for-reviewers/" },
          ],
        },
        {
          text: "超级管理员",
          collapsed: true,
          items: [
            { text: "概览", link: "/user-guide/for-superadmins/" },
            { text: "ML Backend 注册", link: "/user-guide/for-superadmins/ml-backend-registry" },
            { text: "模型市场", link: "/user-guide/for-superadmins/model-market" },
            { text: "失败预测排查", link: "/user-guide/for-superadmins/failed-predictions" },
            { text: "审计日志", link: "/user-guide/for-superadmins/audit-logs" },
            { text: "系统监控", link: "/user-guide/for-superadmins/system-monitoring" },
          ],
        },
        {
          text: "场景 / 工作流",
          collapsed: true,
          items: [
            { text: "新项目端到端", link: "/user-guide/workflows/new-project-end-to-end" },
            { text: "AI 预标注流水线", link: "/user-guide/workflows/ai-preannotate-pipeline" },
            { text: "失败预测恢复", link: "/user-guide/workflows/failed-prediction-recovery" },
          ],
        },
        {
          text: "参考",
          collapsed: true,
          items: [
            { text: "数据导出格式", link: "/user-guide/reference/export-formats" },
          ],
        },
        {
          text: "其他",
          items: [
            { text: "FAQ", link: "/user-guide/faq" },
          ],
        },
      ],

      "/dev/": [
        {
          text: "起步",
          items: [
            { text: "概览", link: "/dev/" },
            { text: "测试指南", link: "/dev/testing" },
            { text: "发布流程", link: "/dev/release" },
          ],
        },
        {
          text: "教程",
          collapsed: true,
          items: [
            { text: "本地开发", link: "/dev/tutorials/local-dev" },
            { text: "第一个贡献", link: "/dev/tutorials/first-contribution" },
          ],
        },
        {
          text: "概念（架构）",
          collapsed: true,
          items: [
            { text: "架构地图", link: "/dev/concepts/" },
            { text: "系统全景", link: "/dev/concepts/overview" },
            { text: "项目模块", link: "/dev/concepts/project-module" },
            { text: "任务模块", link: "/dev/concepts/task-module" },
            { text: "批次模块", link: "/dev/concepts/batch-module" },
            { text: "标注模块", link: "/dev/concepts/annotation-module" },
            { text: "审核模块", link: "/dev/concepts/review-module" },
            { text: "状态机总览", link: "/dev/concepts/state-machines" },
            { text: "Scheduler 与派题", link: "/dev/concepts/scheduler-and-task-dispatch" },
            { text: "Task Lock", link: "/dev/concepts/task-locking" },
            { text: "可见性与权限", link: "/dev/concepts/visibility-and-permissions" },
            { text: "批次生命周期（端到端）", link: "/dev/concepts/batch-lifecycle-end-to-end" },
            { text: "AI 预标注接管", link: "/dev/concepts/ai-preannotate-handoff" },
            { text: "后端基础设施（容器）", link: "/dev/concepts/backend-infrastructure" },
            { text: "后端分层", link: "/dev/concepts/backend-layers" },
            { text: "前端分层", link: "/dev/concepts/frontend-layers" },
            { text: "数据流", link: "/dev/concepts/data-flow" },
            { text: "AI 模型集成", link: "/dev/concepts/ai-models" },
            { text: "API Schema 边界", link: "/dev/concepts/api-schema-boundary" },
            { text: "预标注流水线", link: "/dev/concepts/prediction-pipeline" },
            { text: "部署拓扑", link: "/dev/concepts/deployment-topology" },
            { text: "性能 HUD", link: "/dev/concepts/perfhud" },
          ],
        },
        {
          text: "How-to",
          items: [
            { text: "新增 API 端点", link: "/dev/how-to/add-api-endpoint" },
            { text: "新增前端页面", link: "/dev/how-to/add-page" },
            { text: "Alembic 迁移", link: "/dev/how-to/add-migration" },
            { text: "调试 Celery", link: "/dev/how-to/debug-celery" },
            { text: "调试 WebSocket", link: "/dev/how-to/debug-websocket" },
            { text: "更新截图", link: "/dev/how-to/update-screenshots" },
          ],
        },
        {
          text: "协议与规范",
          collapsed: true,
          items: [
            { text: "ML Backend 协议", link: "/dev/reference/ml-backend-protocol" },
            { text: "WebSocket 协议", link: "/dev/reference/ws-protocol" },
            { text: "代码规范", link: "/dev/reference/conventions" },
            { text: "图标约定", link: "/dev/reference/icon-conventions" },
            { text: "环境变量", link: "/dev/reference/env-vars" },
          ],
        },
        {
          text: "故障排查",
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

      "/ops/": [
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
            { text: "Docker Compose 部署", link: "/ops/deploy/docker-compose" },
          ],
        },
        {
          text: "可观测性",
          items: [
            { text: "监控与告警", link: "/ops/observability/" },
          ],
        },
        {
          text: "安全",
          items: [
            { text: "安全模型", link: "/ops/security/" },
          ],
        },
        {
          text: "Runbooks",
          collapsed: true,
          items: [
            { text: "Celery Worker 卡死", link: "/ops/runbooks/celery-worker-stuck" },
            { text: "ML Backend 不可用", link: "/ops/runbooks/ml-backend-down" },
            { text: "PG 连接池耗尽", link: "/ops/runbooks/postgres-connection-pool-exhausted" },
          ],
        },
      ],

      "/changelog/": changelogSidebarItems,
      "/roadmap/": roadmapSidebarItems,

      "/api/": [
        { text: "API 总览", link: "/api/" },
        {
          text: "指南",
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
