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

export type ScreenshotUserKey = "admin" | "project_admin" | "annotator" | "reviewer";
export type ScreenshotProjectKey =
  | "image_demo"
  | "video_demo"
  | "pointcloud_demo"
  | "ocr_demo";
export type ScreenshotBackendRequirement = "image_interactive" | "video_tracker" | "ocr";

export interface ScreenshotCatalogUser {
  id: string;
  email: string;
  role: string;
}

export interface ScreenshotCatalogTask {
  id: string;
  display_id: string;
  file_name: string;
  file_path: string;
  status: string;
}

export interface ScreenshotCatalogBatch {
  id: string;
  display_id: string;
  status: string;
}

export interface ScreenshotCatalogBackend {
  id: string;
  name: string;
  state: string;
  is_interactive: boolean;
  requirement: ScreenshotBackendRequirement;
  selected_tracker: string | null;
  capabilities: {
    models?: Array<Record<string, unknown>>;
    supported_prompts?: string[];
    supported_trackers?: string[];
    supported_geometric_outputs?: string[];
    [key: string]: unknown;
  };
}

export interface ScreenshotCatalogProject {
  id: string;
  display_id: string;
  name: string;
  data_type: string;
  datasets: Record<string, { id: string; name: string; file_count: number }>;
  tasks: Record<string, ScreenshotCatalogTask>;
  batches: Record<string, ScreenshotCatalogBatch>;
  ml_backend: ScreenshotCatalogBackend | null;
}

export interface ScreenshotSeedCatalog {
  schema_version: 1;
  seed_revision: string;
  users: Record<ScreenshotUserKey, ScreenshotCatalogUser>;
  projects: Record<ScreenshotProjectKey, ScreenshotCatalogProject>;
}

/** v0.16.x · 点云 E2E 基线 fixture：1 个 lidar 项目 + 2 帧(同一最小 .pcd)point_cloud task。
 *  需先 reset()(复用其 E2E 用户),缺则后端补建。 */
export interface SeedLidarData {
  lidar_project_id: string;
  lidar_task_ids: string[];
}

export type RasterMaskFixtureVariant = "single" | "donut_three" | "corrupt";

export interface SeedRasterMaskData {
  annotation_id: string;
  variant: RasterMaskFixtureVariant;
  mask: {
    encoding: "coco_rle_ref";
    size: [number, number];
    object_key: string;
    sha256: string;
    runs: number;
    bytes: number;
  };
}

export interface SeedRasterPredictionData {
  prediction_id: string;
  mask: SeedRasterMaskData["mask"];
}

/** v0.8.7 F4 · 截图脚本只读窥探：返回首个 super_admin / 首个项目 / 首个任务。
 *  字段允许 null（对应数据不存在时），调用方自行兜底。 */
export interface SeedPeekData {
  admin_email: string | null;
  project_id: string | null;
  task_id: string | null;
}

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000";

export class SeedAPI {
  constructor(private request: APIRequestContext) {}

  async accessToken(email: string): Promise<string> {
    const res = await this.request.post(`${API_BASE}/api/v1/__test/seed/login`, {
      data: { email },
    });
    if (!res.ok()) {
      throw new Error(`seed/login failed: ${res.status()} ${await res.text()}`);
    }
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async reset(): Promise<SeedData> {
    const res = await this.request.post(`${API_BASE}/api/v1/__test/seed/reset`);
    if (!res.ok()) {
      throw new Error(`seed/reset failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as SeedData;
  }

  /** 截图专用只读 catalog：解析稳定逻辑键，服务端会对完整 profile fail-closed。 */
  async screenshotCatalog(): Promise<ScreenshotSeedCatalog> {
    const res = await this.request.get(
      `${API_BASE}/api/v1/__test/seed/catalog?profile=screenshots`,
    );
    if (!res.ok()) {
      throw new Error(
        `seed/catalog failed: ${res.status()} ${await res.text()}\n` +
          "请运行 `cd apps/api && PYTHONPATH=. uv run python scripts/seed.py " +
          "--profile screenshots --ml-backend-mode live`。",
      );
    }
    return (await res.json()) as ScreenshotSeedCatalog;
  }

  /** v0.16.x · 造点云 E2E fixture(lidar 项目 + 2 帧 point_cloud task)。需先 reset()。 */
  async seedLidar(): Promise<SeedLidarData> {
    const res = await this.request.post(`${API_BASE}/api/v1/__test/seed/lidar`);
    if (!res.ok()) {
      throw new Error(`seed/lidar failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as SeedLidarData;
  }

  /** 只切项目 opt-in；部署级 read/create 总闸由 API 进程环境决定。 */
  async configureRasterMask(projectId: string, enabled: boolean): Promise<void> {
    const res = await this.request.post(
      `${API_BASE}/api/v1/__test/seed/configure-raster-mask`,
      { data: { project_id: projectId, enabled } },
    );
    if (!res.ok()) {
      throw new Error(
        `seed/configure-raster-mask failed: ${res.status()} ${await res.text()}`,
      );
    }
  }

  /** 构造已有 raster annotation，用于只读、损坏内容与锁定矩阵。 */
  async injectRasterMask(opts: {
    taskId: string;
    userEmail: string;
    variant?: RasterMaskFixtureVariant;
    label?: string;
    locked?: boolean;
  }): Promise<SeedRasterMaskData> {
    const res = await this.request.post(
      `${API_BASE}/api/v1/__test/seed/inject-raster-mask`,
      {
        data: {
          task_id: opts.taskId,
          user_email: opts.userEmail,
          variant: opts.variant ?? "single",
          label: opts.label ?? "car",
          locked: opts.locked ?? false,
        },
      },
    );
    if (!res.ok()) {
      throw new Error(
        `seed/inject-raster-mask failed: ${res.status()} ${await res.text()}`,
      );
    }
    return (await res.json()) as SeedRasterMaskData;
  }

  /** 构造待接受的 raster prediction，只用于 gate 关闭矩阵。 */
  async injectRasterPrediction(opts: {
    taskId: string;
    userEmail: string;
    label?: string;
  }): Promise<SeedRasterPredictionData> {
    const res = await this.request.post(
      `${API_BASE}/api/v1/__test/seed/inject-raster-prediction`,
      {
        data: {
          task_id: opts.taskId,
          user_email: opts.userEmail,
          variant: "single",
          label: opts.label ?? "car",
        },
      },
    );
    if (!res.ok()) {
      throw new Error(
        `seed/inject-raster-prediction failed: ${res.status()} ${await res.text()}`,
      );
    }
    return (await res.json()) as SeedRasterPredictionData;
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
    if (!res.ok()) throw new Error(`seed/login failed: ${res.status()}`);
    const body = (await res.json()) as { access_token: string; user: unknown };
    const target =
      baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
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
   * v0.10.10 · I11 e2e 辅助：直接 INSERT 一条 polygon prediction，绕过 ml-backend。
   * 用于 mask 编辑器「AI prediction 精修」入口测试。
   */
  async injectPrediction(opts: {
    taskId: string;
    projectId: string;
    label: string;
    /** 归一化 [0,1] points, ≥3 顶点 */
    polygon: [number, number][];
    score?: number;
  }): Promise<{ prediction_id: string }> {
    const res = await this.request.post(
      `${API_BASE}/api/v1/__test/seed/inject-prediction`,
      {
        data: {
          task_id: opts.taskId,
          project_id: opts.projectId,
          label: opts.label,
          polygon: opts.polygon,
          score: opts.score ?? 0.9,
        },
      },
    );
    if (!res.ok()) {
      throw new Error(`seed/inject-prediction failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as { prediction_id: string };
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
