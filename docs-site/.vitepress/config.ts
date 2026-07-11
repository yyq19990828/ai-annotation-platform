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
    // ADR mirrors may point back to repo-local docs/plans files, which are not
    // rendered as VitePress pages.（兼容 v0.21+ 引入的 plans/archive/ 子目录）
    (url) =>
      /(^|\/)\.\.\/plans\/(archive\/)?\d{4}-/.test(url) ||
      /\/plans\/(archive\/)?\d{4}-/.test(url),
    (url) => /IMAGE_CHECKLIST/.test(url),
    // ROADMAP/inspiration 文档引用本地 clone 的 CVAT 源码（`../../cvat/...`），
    // 这些不是站点页面，构建期不应判为 dead。
    (url) => /\/cvat\//.test(url) || /\/cvat-(sdk|cli)(\/|$)/.test(url),
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
    build: {
      // VitePress local search emits a large generated index for the whole docs site.
      // Keep the threshold above that expected artifact while still warning on accidental
      // multi-megabyte application chunks.
      chunkSizeWarningLimit: 2048,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return;
            if (id.includes("/@scalar/")) return "vendor-api-reference";
            if (id.includes("/minisearch/")) return "vendor-search";
            if (id.includes("/vitepress/")) return "vendor-vitepress";
            if (id.includes("/vue/") || id.includes("/@vue/")) return "vendor-vue";
          },
        },
      },
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
          text: "工作台 · 通用",
          items: [
            { text: "工作台概览与快捷键", link: "/user-guide/workbench/" },
            { text: "工作台设置", link: "/user-guide/workbench/settings" },
          ],
        },
        {
          text: "AI 辅助标注",
          items: [
            { text: "AI 能力总览", link: "/user-guide/ai/" },
            { text: "图片交互式 AI", link: "/user-guide/workbench/sam-tool" },
            { text: "当前题 AI 与二次推理", link: "/user-guide/ai/current-task-inference" },
            { text: "审阅 AI 候选", link: "/user-guide/ai/candidate-review" },
            { text: "批量与多阶段预标", link: "/user-guide/projects/ai-preannotate" },
            { text: "视频 AI 追踪", link: "/user-guide/workbench/video-propagate" },
            { text: "外部预测导入 / 导出", link: "/user-guide/datasets/prediction-import-export" },
            { text: "项目 ML 模型", link: "/user-guide/projects/ml-backends" },
            { text: "全局编排库", link: "/user-guide/projects/pipeline-library" },
            { text: "AI 任务与失败恢复", link: "/user-guide/workflows/failed-prediction-recovery" },
            { text: "模型市场", link: "/user-guide/superadmin/model-market" },
          ],
        },
        {
          text: "图片标注",
          items: [
            { text: "Bbox 标注", link: "/user-guide/workbench/bbox" },
            { text: "旋转框标注 (OBB)", link: "/user-guide/workbench/rotated-bbox" },
            { text: "Polygon 标注", link: "/user-guide/workbench/polygon" },
            { text: "折线标注", link: "/user-guide/workbench/polyline" },
            { text: "关键点标注", link: "/user-guide/workbench/keypoint" },
            { text: "Mask 笔刷编辑器", link: "/user-guide/workbench/mask-brush" },
            { text: "SAM 智能工具", link: "/user-guide/workbench/sam-tool" },
          ],
        },
        {
          text: "视频标注",
          items: [
            { text: "视频追踪标注", link: "/user-guide/workbench/video-track" },
            { text: "播放、帧导航与采样", link: "/user-guide/workbench/video-playback" },
            { text: "关键帧传播与 AI", link: "/user-guide/workbench/video-propagate" },
          ],
        },
        {
          text: "点云标注",
          items: [
            { text: "点云视图与上色", link: "/user-guide/workbench/pointcloud-view" },
            { text: "3D 立体框标注", link: "/user-guide/workbench/3d-box" },
            { text: "点云跨模态联动", link: "/user-guide/workbench/pointcloud-projection" },
            { text: "点云跨帧标注", link: "/user-guide/workbench/pointcloud-crossframe" },
          ],
        },
        {
          text: "数据集 · 导入导出",
          collapsed: true,
          items: [
            { text: "数据集总览", link: "/user-guide/datasets/" },
            { text: "导入图像数据集", link: "/user-guide/datasets/import-images" },
            { text: "导入点云 / 多模态", link: "/user-guide/datasets/import-formats" },
            { text: "存储连接器导入", link: "/user-guide/datasets/storage-connections" },
            { text: "点云坐标系约定", link: "/user-guide/datasets/lidar-axis-convention" },
            { text: "导入 / 导出外部预测", link: "/user-guide/datasets/prediction-import-export" },
            { text: "数据导出格式", link: "/user-guide/reference/export-formats" },
          ],
        },
        {
          text: "项目管理",
          collapsed: true,
          items: [
            { text: "项目管理", link: "/user-guide/projects/" },
            { text: "工具维度类别 / 属性", link: "/user-guide/projects/tool-units" },
            { text: "Data Manager", link: "/user-guide/projects/data-manager" },
            { text: "批次与分配", link: "/user-guide/projects/batch" },
            { text: "AI 预标注", link: "/user-guide/projects/ai-preannotate" },
            { text: "全局编排库", link: "/user-guide/projects/pipeline-library" },
            { text: "ML 后端绑定", link: "/user-guide/projects/ml-backends" },
            { text: "项目模板", link: "/user-guide/projects/project-templates" },
          ],
        },
        {
          text: "审核",
          items: [
            { text: "审核流程", link: "/user-guide/review/" },
          ],
        },
        {
          text: "平台管理",
          collapsed: true,
          items: [
            { text: "概览", link: "/user-guide/superadmin/" },
            { text: "用户与权限", link: "/user-guide/superadmin/user-management" },
            { text: "ML Backend 注册", link: "/user-guide/superadmin/ml-backend-registry" },
            { text: "模型市场", link: "/user-guide/superadmin/model-market" },
            { text: "失败预测排查", link: "/user-guide/superadmin/failed-predictions" },
            { text: "审计日志", link: "/user-guide/superadmin/audit-logs" },
            { text: "系统监控", link: "/user-guide/superadmin/system-monitoring" },
            { text: "BUG 反馈管理", link: "/user-guide/superadmin/bug-management" },
            { text: "离线分析", link: "/user-guide/superadmin/analytics" },
            { text: "公共模板治理", link: "/user-guide/superadmin/public-templates" },
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
            { text: "通知中心", link: "/user-guide/reference/notifications" },
            { text: "设置页", link: "/user-guide/reference/settings" },
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
            {
              text: "总览",
              items: [
                { text: "架构地图", link: "/dev/concepts/" },
                { text: "系统全景", link: "/dev/concepts/overview" },
              ],
            },
            {
              text: "业务域模型",
              items: [
                { text: "项目模块", link: "/dev/concepts/project-module" },
                { text: "批次模块", link: "/dev/concepts/batch-module" },
                { text: "任务模块", link: "/dev/concepts/task-module" },
                { text: "标注模块", link: "/dev/concepts/annotation-module" },
                { text: "视频标注工作台", link: "/dev/concepts/video-annotation-workbench" },
                { text: "Scene 与帧索引", link: "/dev/concepts/scene-and-frame-index" },
                { text: "审核模块", link: "/dev/concepts/review-module" },
              ],
            },
            {
              text: "工作流与协作机制",
              items: [
                { text: "状态机总览", link: "/dev/concepts/state-machines" },
                { text: "Scheduler 与派题", link: "/dev/concepts/scheduler-and-task-dispatch" },
                { text: "Task Lock", link: "/dev/concepts/task-locking" },
                { text: "可见性与权限", link: "/dev/concepts/visibility-and-permissions" },
                { text: "计数与派生字段", link: "/dev/concepts/counters-and-derived-fields" },
                { text: "审计与通知", link: "/dev/concepts/audit-and-notifications" },
                { text: "反馈收敛与双写对账", link: "/dev/concepts/feedback-convergence" },
              ],
            },
            {
              text: "端到端业务流程",
              items: [
                { text: "批次生命周期（端到端）", link: "/dev/concepts/batch-lifecycle-end-to-end" },
                { text: "AI 预标注接管", link: "/dev/concepts/ai-preannotate-handoff" },
                { text: "数据流", link: "/dev/concepts/data-flow" },
                { text: "存储连接器", link: "/dev/concepts/storage-connections" },
              ],
            },
            {
              text: "AI 与推理子系统",
              items: [
                { text: "预标注流水线", link: "/dev/concepts/prediction-pipeline" },
                { text: "视频 AI 追踪", link: "/dev/concepts/video-ai-tracking" },
                { text: "AI 模型集成", link: "/dev/concepts/ai-models" },
              ],
            },
            {
              text: "平台实现架构",
              items: [
                { text: "后端分层", link: "/dev/concepts/backend-layers" },
                { text: "前端分层", link: "/dev/concepts/frontend-layers" },
                { text: "工作台 Shell 架构", link: "/dev/concepts/workbench-shell" },
                { text: "API Schema 边界", link: "/dev/concepts/api-schema-boundary" },
                { text: "后端基础设施（容器）", link: "/dev/concepts/backend-infrastructure" },
                { text: "部署拓扑", link: "/dev/concepts/deployment-topology" },
                { text: "运行环境形态（dev/staging/prod）", link: "/dev/concepts/runtime-environments" },
                { text: "性能 HUD", link: "/dev/concepts/perfhud" },
              ],
            },
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
            { text: "迁移内联样式到 CSS Modules", link: "/dev/how-to/migrate-inline-style-to-css-modules" },
            { text: "视频工作台性能回归", link: "/dev/how-to/video-workbench-performance-regression" },
          ],
        },
        {
          text: "SDK 与 CLI",
          collapsed: true,
          items: [
            { text: "快速上手", link: "/dev/sdk/quickstart" },
            { text: "Python SDK 参考", link: "/dev/sdk/python-client" },
            { text: "CLI 参考", link: "/dev/sdk/cli" },
            { text: "TUI 监控面板", link: "/dev/sdk/tui" },
            { text: "Cookbook", link: "/dev/sdk/cookbook" },
          ],
        },
        {
          text: "协议与规范",
          collapsed: true,
          items: [
            { text: "ML Backend 协议", link: "/dev/reference/ml-backend-protocol" },
            { text: "ML Backend 接入教程", link: "/dev/ml-backend/starter" },
            { text: "YOLO 导入适配", link: "/dev/reference/yolo-import" },
            { text: "WebSocket 协议", link: "/dev/reference/ws-protocol" },
            { text: "视频帧服务", link: "/dev/reference/video-frame-service" },
            { text: "点云联合标注数据模型", link: "/dev/reference/point-cloud-data-model" },
            { text: "点云导出格式", link: "/dev/reference/lidar-export-formats" },
            { text: "Data Manager 查询与聚合", link: "/dev/reference/data-manager-query" },
            { text: "设计系统", link: "/dev/reference/design-system" },
            { text: "代码规范", link: "/dev/reference/conventions" },
            { text: "图标约定", link: "/dev/reference/icon-conventions" },
            { text: "环境变量", link: "/dev/reference/env-vars" },
            { text: "存储桶布局", link: "/dev/reference/storage-buckets" },
            { text: "连接器安全", link: "/dev/reference/connector-security" },
            { text: "内部 API 端点", link: "/dev/reference/internal-api-endpoints" },
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
            { text: "部署总览", link: "/ops/deploy/" },
            { text: "开发部署（本地）", link: "/ops/deploy/development" },
            { text: "生产部署（Docker Compose）", link: "/ops/deploy/docker-compose" },
            { text: "端口暴露与网络安全", link: "/ops/deploy/network-security" },
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
            { text: "视频帧服务", link: "/ops/runbooks/video-frame-service" },
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
