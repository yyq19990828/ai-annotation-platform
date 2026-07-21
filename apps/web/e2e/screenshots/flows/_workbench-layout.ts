/**
 * 工作台流程录制的用户偏好沙箱。
 *
 * 录制需要确定性布局，但工作台侧栏和设置都是账号级持久偏好。
 * 这里只改写 GET 响应，并在内存中响应 PATCH，确保页面内交互正常，
 * 同时不把任何录制设置写回真实用户。Playwright context 关闭后即无痕清理。
 */
import type { Locator, Page } from "@playwright/test";
import type {
  UserPreferences,
  WorkbenchLayoutPreferences,
  WorkbenchPreferences,
} from "../../../src/api/auth";

export type RecordingSidebarMode = "both" | "none";

function embeddedLayout(
  layout: WorkbenchLayoutPreferences,
  open: boolean,
): WorkbenchLayoutPreferences {
  return {
    ...layout,
    leftOpen: open,
    rightOpen: open,
    floatingTaskQueue: { ...layout.floatingTaskQueue, detached: false },
    floatingClassPalette: { ...layout.floatingClassPalette, detached: false },
    floatingInspector: { ...layout.floatingInspector, detached: false },
    floatingDiscussion: { ...layout.floatingDiscussion, detached: false },
  };
}

function applyRecordingLayout(
  preferences: UserPreferences,
  mode: RecordingSidebarMode,
): UserPreferences {
  const open = mode === "both";
  return {
    ...preferences,
    workbench: {
      ...preferences.workbench,
      common: {
        ...preferences.workbench.common,
        leftWidthPct: 15,
        rightWidthPct: 15,
      },
      layout: embeddedLayout(preferences.workbench.layout, open),
    },
  };
}

function mergeWorkbench(
  current: WorkbenchPreferences,
  patch: Partial<WorkbenchPreferences>,
): WorkbenchPreferences {
  return {
    ...current,
    ...patch,
    common: { ...current.common, ...(patch.common ?? {}) },
    image: { ...current.image, ...(patch.image ?? {}) },
    video: { ...current.video, ...(patch.video ?? {}) },
    pointcloud: { ...current.pointcloud, ...(patch.pointcloud ?? {}) },
    layout: { ...current.layout, ...(patch.layout ?? {}) },
  };
}

function mergePreferences(
  current: UserPreferences,
  patch: Partial<UserPreferences>,
): UserPreferences {
  return {
    ...current,
    ...patch,
    workbench: patch.workbench
      ? mergeWorkbench(current.workbench, patch.workbench)
      : current.workbench,
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) },
  };
}

export async function installRecordingWorkbenchLayout(
  page: Page,
  mode: RecordingSidebarMode,
): Promise<void> {
  const original = await page.evaluate(async () => {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("[recording-layout] localStorage 缺少 token");
    const response = await fetch("/api/v1/auth/me/preferences", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`[recording-layout] 读取偏好失败: HTTP ${response.status}`);
    }
    return response.json() as Promise<UserPreferences>;
  });

  const screenshotTheme = await page.evaluate(() => localStorage.getItem("anno.theme"));
  let sandbox = applyRecordingLayout(original, mode);
  if (screenshotTheme === "light" || screenshotTheme === "dark") {
    sandbox = {
      ...sandbox,
      ui: { ...sandbox.ui, theme: screenshotTheme },
    };
  }
  await page.route("**/api/v1/auth/me/preferences", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ status: 200, json: sandbox });
      return;
    }
    if (method === "PATCH") {
      const patch = route.request().postDataJSON() as Partial<UserPreferences>;
      sandbox = applyRecordingLayout(mergePreferences(sandbox, patch), mode);
      await route.fulfill({ status: 200, json: sandbox });
      return;
    }
    await route.continue();
  });

  // 工作台首帧优先读按账号分桶的 localStorage；导航前同步写入沙箱值，
  // 避免先显示真实账号布局、等 GET 回来后再跳到录制布局的闪动。
  await page.evaluate((preferences) => {
    const raw = localStorage.getItem("auth-storage");
    if (!raw) throw new Error("[recording-layout] localStorage 缺少 auth-storage");
    const auth = JSON.parse(raw) as {
      state?: {
        user?: {
          id?: string;
          preferences?: UserPreferences;
        };
      };
    };
    const user = auth.state?.user;
    if (!user?.id) throw new Error("[recording-layout] auth-storage 缺少 user.id");
    user.preferences = preferences;
    localStorage.setItem("auth-storage", JSON.stringify(auth));
    localStorage.setItem(
      `workbench.${user.id}.leftOpen`,
      preferences.workbench.layout.leftOpen ? "1" : "0",
    );
    localStorage.setItem(
      `workbench.${user.id}.rightOpen`,
      preferences.workbench.layout.rightOpen ? "1" : "0",
    );
  }, sandbox);
}

/** 录制开始前验证侧栏开合与 15% 宽度已真正进入 DOM。 */
export async function waitForRecordingWorkbenchLayout(
  page: Page,
  mode: RecordingSidebarMode,
): Promise<void> {
  const expectedLeftTitle = mode === "both" ? "收起任务列表" : "展开任务列表";
  const expectedRightTitle = mode === "both" ? "收起标注详情" : "展开标注详情";
  await page.getByTitle(expectedLeftTitle).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTitle(expectedRightTitle).waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction((sidebarMode) => {
    const root = document.querySelector<HTMLElement>('[style*="--workbench-grid-template"]');
    const value = root?.style.getPropertyValue("--workbench-grid-template") ?? "";
    return sidebarMode === "both"
      ? value.includes("clamp(180px, 15%, 600px) 48px 1fr clamp(180px, 15%, 600px)")
      : value === "0px 48px 1fr 0px";
  }, mode, { timeout: 10_000 });
}

/**
 * 把可拖动的当前题 AI 面板停到视口最右侧，避免录制时遮住中央主图。
 * 走真实 pointer drag，只影响隔离的 Playwright context，不改产品默认定位。
 */
export async function dockAiPanelAtViewportRight(
  page: Page,
  panel: Locator,
): Promise<void> {
  const header = panel.getByTitle("拖动 AI 面板");
  const [panelBox, headerBox] = await Promise.all([
    panel.boundingBox(),
    header.boundingBox(),
  ]);
  const viewport = page.viewportSize();
  if (!panelBox || !headerBox || !viewport) {
    throw new Error("[recording-layout] 无法定位当前题 AI 面板");
  }

  const deltaX = viewport.width - panelBox.x - panelBox.width - 8;
  const startX = headerBox.x + headerBox.width / 2;
  const startY = headerBox.y + Math.min(18, headerBox.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction(() => {
    const node = document.querySelector<HTMLElement>(
      '[data-testid="ai-prediction-popover"]',
    );
    if (!node) return false;
    return Math.abs(window.innerWidth - node.getBoundingClientRect().right - 8) <= 2;
  }, undefined, { timeout: 5_000 });
}
