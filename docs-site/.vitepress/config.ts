import { defineConfig } from "vitepress";

export default defineConfig({
  title: "AI Annotation Platform",
  description: "标注平台文档（用户 / 开发 / API）",
  lang: "zh-CN",
  base: process.env.DOCS_BASE ?? "/",
  cleanUrls: true,
  lastUpdated: true,
  // 允许指向本地开发服务器的链接，构建期不当 dead link
  ignoreDeadLinks: [/^https?:\/\/localhost(:\d+)?(\/|$)/],

  themeConfig: {
    nav: [
      { text: "用户手册", link: "/user-guide/" },
      { text: "开发文档", link: "/dev/" },
      { text: "API 文档", link: "/api/" },
      { text: "CHANGELOG", link: "https://github.com/yyq19990828/ai-annotation-platform/blob/main/CHANGELOG.md" },
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
            { text: "后端分层", link: "/dev/architecture/backend-layers" },
            { text: "前端分层", link: "/dev/architecture/frontend-layers" },
            { text: "数据流", link: "/dev/architecture/data-flow" },
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
      ],

      "/api/": [
        { text: "API 总览", link: "/api/" },
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
});
