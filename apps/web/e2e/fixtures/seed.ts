/**
 * v0.8.3 · E2E 共享 fixtures：调用后端 _test_seed router 造数与跳登录。
 *
 * 后端要求（`_test_seed.py`）：
 *   - settings.environment !== 'production' 时挂载
 *   - POST /api/v1/__test/seed/reset → truncate + 重建固定 fixture
 *   - POST /api/v1/__test/seed/login {email} → 返回 access_token
 *
 * 用法：
 *   import { test } from "../fixtures/seed";
 *   test("登录后跳 dashboard", async ({ page, seed }) => {
 *     const data = await seed.reset();
 *     await seed.loginViaUI(page, data.admin_email, "Test1234");
 *   });
 */
import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";

export interface SeedData {
  admin_email: string;
  annotator_email: string;
  reviewer_email: string;
  project_id: string;
  task_ids: string[];
  /** v0.9.4 phase 3: SAM E2E 用 mock backend; url=http://mock-sam.e2e:9999, page.route 拦截 */
  ml_backend_id: string;
}

/** v0.8.7 F4 · 截图脚本只读窥探：返回首个 super_admin / 首个项目 / 首个任务。
 *  字段允许 null（对应数据不存在时），调用方自行兜底。 */
export interface SeedPeekData {
  admin_email: string | null;
  project_id: string | null;
  task_id: string | null;
}

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000";

class SeedAPI {
  constructor(private request: APIRequestContext) {}

  async reset(): Promise<SeedData> {
    const res = await this.request.post(`${API_BASE}/api/v1/__test/seed/reset`);
    if (!res.ok()) {
      throw new Error(`seed/reset failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as SeedData;
  }

  /** v0.8.7 F4 · 只读窥探现有数据；不破坏 dev 数据。 */
  async peek(): Promise<SeedPeekData> {
    const res = await this.request.get(`${API_BASE}/api/v1/__test/seed/peek`);
    if (!res.ok()) {
      throw new Error(`seed/peek failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as SeedPeekData;
  }

  /** 直接拿 JWT 注入 localStorage（跳过 UI 登录，加快非 auth spec）。 */
  async injectToken(page: Page, email: string, baseURL?: string): Promise<void> {
    const res = await this.request.post(`${API_BASE}/api/v1/__test/seed/login`, {
      data: { email },
    });
    if (!res.ok()) {
      throw new Error(`seed/login failed: ${res.status()}`);
    }
    const body = (await res.json()) as { access_token: string; user: unknown };
    const target = baseURL ?? "http://localhost:3000";
    await page.goto(target);
    await page.evaluate(
      ({ token, user }) => {
        localStorage.setItem("token", token);
        // zustand persist 写入 auth-storage 同步形态
        localStorage.setItem(
          "auth-storage",
          JSON.stringify({ state: { token, user }, version: 0 }),
        );
      },
      { token: body.access_token, user: body.user },
    );
  }

  /** UI 路径登录：filling form + click 提交（auth spec 主用）。 */
  async loginViaUI(page: Page, email: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.getByPlaceholder("输入账号或邮箱").fill(email);
    await page.getByPlaceholder("••••••••").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    // 跳 dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  }

  /**
   * v0.8.5 · E2E 辅助：直接置 task 状态，绕过 UI 链路。
   * 多角色串联 spec 用此跳过画框 / 提交流程，专注验证下游交接。
   */
  async advanceTask(opts: {
    taskId: string;
    toStatus: "pending" | "annotating" | "submitted" | "review" | "completed" | "rejected";
    annotatorEmail?: string;
    reviewerEmail?: string;
  }): Promise<void> {
    const res = await this.request.post(
      `${API_BASE}/api/v1/__test/seed/advance_task`,
      {
        data: {
          task_id: opts.taskId,
          to_status: opts.toStatus,
          annotator_email: opts.annotatorEmail,
          reviewer_email: opts.reviewerEmail,
        },
      },
    );
    if (!res.ok()) {
      throw new Error(
        `seed/advance_task failed: ${res.status()} ${await res.text()}`,
      );
    }
  }
}

type Fixtures = {
  seed: SeedAPI;
};

export const test = base.extend<Fixtures>({
  seed: async ({ request }, use) => {
    const api = new SeedAPI(request);
    // playwright fixture 的 use 不是 React Hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(api);
  },
});

export { expect };
