/**
 * M2 · 网络状态模拟：用 page.route() 拦截 /api/v1/** 返回指定状态。
 *
 * 使用方式（driver 内部调用）：
 *   const cleanup = await setupMockState(page, scene.mockState);
 *   await page.goto(route);
 *   ...
 *   await cleanup();
 */
import type { Page } from "@playwright/test";

export type MockState = "happy" | "empty" | "error" | "loading" | "rate-limited";

const API_PATTERN = "**/api/v1/**";

/** 激活网络 mock；返回清除函数。 */
export async function setupMockState(
  page: Page,
  state: MockState | undefined,
): Promise<() => Promise<void>> {
  if (!state || state === "happy") return async () => {};

  switch (state) {
    case "empty": {
      await page.route(API_PATTERN, (route) => {
        const url = route.request().url();
        // 只对 GET 列表端点返回空
        if (route.request().method() === "GET" && /\/(tasks|projects|batches|annotations)/.test(url)) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ items: [], total: 0, page: 1, size: 20 }),
          });
        }
        return route.continue();
      });
      break;
    }

    case "error": {
      await page.route(API_PATTERN, (route) => {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Internal Server Error (mock)" }),
        });
      });
      break;
    }

    case "loading": {
      // 延迟响应 —— 截图时页面处于 loading skeleton 状态
      await page.route(API_PATTERN, async (route) => {
        await new Promise((r) => setTimeout(r, 30_000));
        return route.continue();
      });
      break;
    }

    case "rate-limited": {
      await page.route(API_PATTERN, (route) => {
        return route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Rate limit exceeded (mock)" }),
          headers: { "Retry-After": "60" },
        });
      });
      break;
    }
  }

  return async () => {
    await page.unrouteAll();
  };
}
