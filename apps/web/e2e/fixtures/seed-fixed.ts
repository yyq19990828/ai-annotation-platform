/**
 * M4 · 视觉回归专用 fixture：调用 seed/reset 产出固定数据集。
 *
 * 与 seed.ts 的区别：
 *   - seed.ts (peek)  → 只读窥探现有数据，不破坏 dev 数据，供素材产出用
 *   - seed-fixed.ts   → 每次 reset 到固定 fixture，保证视觉回归基线一致
 *
 * 视觉回归必须用固定数据：真实 dev 数据随时间漂移会导致图片 diff 噪声。
 *
 * 用法：
 *   import { test } from "../fixtures/seed-fixed";
 */
import { test as base, type Page, type APIRequestContext } from "@playwright/test";
import type { SeedData } from "./seed";

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000";

class FixedSeedAPI {
  constructor(private request: APIRequestContext) {}

  /** 调用 seed/reset，返回固定 fixture 数据。 */
  async reset(): Promise<SeedData> {
    const res = await this.request.post(`${API_BASE}/api/v1/__test/seed/reset`);
    if (!res.ok()) {
      throw new Error(`seed/reset failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as SeedData;
  }

  /** 直接拿 JWT 注入 localStorage，跳过 UI 登录。 */
  async injectToken(page: Page, email: string): Promise<void> {
    const res = await this.request.post(`${API_BASE}/api/v1/__test/seed/login`, {
      data: { email },
    });
    if (!res.ok()) throw new Error(`seed/login failed: ${res.status()}`);
    const body = (await res.json()) as { access_token: string; user: unknown };
    await page.goto("http://localhost:3000");
    await page.evaluate(
      ({ token, user }) => {
        localStorage.setItem("token", token);
        localStorage.setItem(
          "auth-storage",
          JSON.stringify({ state: { token, user }, version: 0 }),
        );
      },
      { token: body.access_token, user: body.user },
    );
  }
}

type FixedFixtures = { fixedSeed: FixedSeedAPI; seedData: SeedData };

export const test = base.extend<FixedFixtures>({
  fixedSeed: async ({ request }, use) => {
    // playwright fixture 的 use 不是 React Hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(new FixedSeedAPI(request));
  },
  seedData: async ({ fixedSeed }, use) => {
    const data = await fixedSeed.reset();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(data);
  },
});

export { expect } from "@playwright/test";
