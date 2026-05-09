import type { Page } from "@playwright/test";
import type { SeedData } from "../../fixtures/seed";

export type Role = "admin" | "annotator" | "reviewer";

export interface MatrixAxis {
  viewport: "desktop" | "tablet" | "mobile";
  theme: "light" | "dark";
  locale: "zh-CN" | "en-US";
}

export interface ScreenshotScene {
  name: string;
  /** 单角色或多角色（多角色时取第一个登录） */
  role: Role | Role[];
  route: (data: SeedData) => string;
  /** 进页面后的准备步骤（开 modal / 切 tab / 键盘交互等） */
  prepare?: (page: Page, data: SeedData) => Promise<void>;

  /**
   * 自动红框 / 编号注释（截图前用 SVG overlay 注入，截图后自动移除）。
   * 仅在 page 级截图生效（fullPage / viewport / clip）；locator 截图无效。
   */
  annotate?: Array<{
    selector: string;
    style?: "rect-red" | "rect-blue" | "arrow" | "numbered";
    label?: string;
  }>;

  /**
   * 网络状态模拟（使用 page.route 拦截 API 请求）。
   * - happy    : 正常（不拦截，默认）
   * - empty    : 列表端点返回空数组
   * - error    : 所有 /api/v1/** 返回 500
   * - loading  : 所有 /api/v1/** 延迟 30s（截图前已禁动画，用于展示 skeleton）
   * - rate-limited : 返回 429
   */
  mockState?: "happy" | "empty" | "error" | "loading" | "rate-limited";

  /**
   * 截图模式（不填 = viewport 截图，等同 v0.8.7 行为）。
   * - fullPage : fullPage:true
   * - locator  : locator.screenshot()，可加 padding 扩展边距
   * - clip     : page.screenshot({ clip: rect })
   */
  capture?:
    | { kind: "fullPage" }
    | { kind: "locator"; selector: string; padding?: number }
    | { kind: "clip"; rect: { x: number; y: number; width: number; height: number } };

  /**
   * 额外 mask 选择器（叠加到 driver 全局默认 mask 之上）。
   * Playwright 会用紫色块遮盖匹配到的元素。
   */
  mask?: string[];

  /**
   * 矩阵维度声明（不填 = 只跑 desktop-light）。
   * driver 根据当前 Playwright project 名称决定是否跑此 scene。
   */
  matrix?: {
    viewports?: Array<"desktop" | "tablet" | "mobile">;
    themes?: Array<"light" | "dark">;
    locales?: Array<"zh-CN" | "en-US">;
  };

  /**
   * 输出路径（相对仓库根 docs-site/user-guide/...）。
   * 矩阵非默认轴时 driver 自动追加后缀（.dark / .tablet / .mobile 等）。
   */
  target: string | ((axis: MatrixAxis) => string);

  /** @deprecated 已改为 matrix.viewports；仍支持但优先级低于 matrix */
  viewport?: { width: number; height: number };
}
