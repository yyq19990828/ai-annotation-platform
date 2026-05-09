import type { ScreenshotScene } from "./_types";

export const AI_PRE_SCENES: ScreenshotScene[] = [
  {
    name: "ai-pre/stepper",
    role: "admin",
    route: () => "/ai-pre",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 默认 4 步全 pending；截信息架构入口态
      // maintainer 选完项目+batch 后再截「进行中」状态
    },
    target: "docs-site/user-guide/images/projects/ai-pre-stepper.png",
  },
  {
    name: "ai-pre/history-search",
    role: "admin",
    route: () => "/ai-pre",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 需 seed 5+ pre_annotated 批次才能展示搜索框；空 seed 截空态
    },
    target: "docs-site/user-guide/images/projects/ai-pre-history-search.png",
  },
  {
    name: "ai-pre/empty-alias",
    role: "admin",
    route: () => "/ai-pre",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 需 seed ai_enabled=true 但类别无 alias 的项目
    },
    target: "docs-site/user-guide/images/projects/ai-pre-empty-alias.png",
  },
  {
    name: "wizard/step4-backend",
    role: "admin",
    route: () => "/projects",
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      // 需 seed 注册过的 backend + 手动走 wizard step1-3
      // 自动化截 wizard 入口态，maintainer 后续补完整流程图
    },
    target: "docs-site/user-guide/images/projects/wizard-step4-backend.png",
  },
];
