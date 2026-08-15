/**
 * 高清母版：超级管理员平台概览的全局统计、运营趋势与近期活动。
 *
 * 使用录制专用的确定性聚合快照，避免真实账号、审计事件和成本进入素材；
 * 页面布局、卡片、图表与滚动仍走真实产品实现。
 */
import { expect, type Page } from "@playwright/test";
import type { DrawWindow } from "./rotated-bbox";

const PROJECTS = [
  {
    id: "demo-project-road",
    display_id: "P-ROAD-12",
    name: "道路车辆精标",
    type_label: "图像检测",
    type_key: "image-det",
    data_type: "image",
    owner_id: "demo-owner-a",
    owner_name: "林项目",
    member_count: 8,
    status: "in_progress",
    total_tasks: 4_800,
    completed_tasks: 3_260,
    review_tasks: 420,
    ai_enabled: true,
    due_date: null,
    created_at: "2026-07-18T02:00:00.000Z",
    updated_at: "2026-08-15T18:40:00.000Z",
  },
  {
    id: "demo-project-video",
    display_id: "P-VIDEO-08",
    name: "城市公交多目标追踪",
    type_label: "视频追踪",
    type_key: "video-track",
    data_type: "video",
    owner_id: "demo-owner-b",
    owner_name: "周算法",
    member_count: 6,
    status: "pending_review",
    total_tasks: 2_400,
    completed_tasks: 2_180,
    review_tasks: 220,
    ai_enabled: true,
    due_date: null,
    created_at: "2026-07-25T02:00:00.000Z",
    updated_at: "2026-08-15T18:32:00.000Z",
  },
  {
    id: "demo-project-lidar",
    display_id: "P-LIDAR-05",
    name: "园区点云障碍物",
    type_label: "3D 点云",
    type_key: "lidar-3d",
    data_type: "lidar",
    owner_id: "demo-owner-c",
    owner_name: "陈质检",
    member_count: 5,
    status: "completed",
    total_tasks: 1_280,
    completed_tasks: 1_280,
    review_tasks: 0,
    ai_enabled: false,
    due_date: null,
    created_at: "2026-06-30T02:00:00.000Z",
    updated_at: "2026-08-15T17:55:00.000Z",
  },
];

const REGISTRATION_BY_DAY = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 6, 17 + index)).toISOString().slice(0, 10),
  invite_count: [1, 2, 0, 3, 1, 4][index % 6],
  open_count: [0, 1, 2, 1, 3, 1][index % 6],
}));

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function dashboardFixture() {
  return {
    total_users: 48,
    active_users: 17,
    total_projects: 8,
    projects_in_progress: 4,
    projects_completed: 2,
    projects_pending_review: 1,
    projects_archived: 1,
    total_tasks: 12_480,
    total_annotations: 36_920,
    ml_backends_total: 3,
    ml_backends_connected: 3,
    role_distribution: {
      super_admin: 2,
      project_admin: 6,
      annotator: 29,
      reviewer: 8,
      viewer: 3,
    },
    registration_by_day: REGISTRATION_BY_DAY,
    pre_annotated_batches: 2,
  };
}

function auditFixture() {
  const item = (
    id: number,
    action: string,
    actorEmail: string,
    targetType: string,
    targetId: string,
    ageMinutes: number,
  ) => ({
    id,
    action,
    actor_email: actorEmail,
    actor_id: `demo-actor-${id}`,
    actor_role: "project_admin",
    created_at: minutesAgo(ageMinutes),
    detail_json: null,
    ip: null,
    method: null,
    path: null,
    request_id: null,
    status_code: null,
    target_id: targetId,
    target_type: targetType,
  });

  return {
    items: [
      item(104, "project.update", "pm@example.invalid", "project", "P-ROAD-12", 6),
      item(103, "ai.preannotate.triggered", "ai@example.invalid", "project", "P-VIDEO-08", 14),
      item(102, "project.member_add", "admin@example.invalid", "project", "P-LIDAR-05", 23),
      item(101, "ml_backend.updated", "ops@example.invalid", "ml_backend", "vehicle-pool", 31),
    ],
    total: 4,
    page: 1,
    page_size: 8,
    next_cursor: null,
  };
}

async function installPlatformOverviewFixture(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;

    if (url.pathname === "/api/v1/dashboard/admin") {
      body = dashboardFixture();
    } else if (url.pathname === "/api/v1/dashboard/admin/prediction-cost-stats") {
      body = {
        range: url.searchParams.get("range") === "7d" ? "7d" : "30d",
        total_predictions: 18_640,
        failed_predictions: 112,
        failure_rate: 0.006,
        avg_inference_time_ms: 86,
        p50_inference_time_ms: 54,
        p95_inference_time_ms: 182,
        p99_inference_time_ms: 310,
        total_cost: 42.7816,
        total_tokens: 2_480_000,
        by_backend: [],
      };
    } else if (url.pathname === "/api/v1/projects") {
      body = PROJECTS;
    } else if (url.pathname === "/api/v1/audit-logs") {
      body = auditFixture();
    } else {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function smoothScrollTo(page: Page, text: string): Promise<void> {
  const target = page.getByRole("heading", { name: text, exact: true });
  await expect(target).toBeAttached();
  const top = await target.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY - 28,
  );
  await page.evaluate((scrollTop) => window.scrollTo({ top: scrollTop, behavior: "smooth" }), top);
  await page.waitForTimeout(900);
  await expect(target).toBeVisible();
}

export async function runPlatformOverview(page: Page): Promise<DrawWindow> {
  await installPlatformOverviewFixture(page);
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "平台概览", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("36,920", { exact: true })).toBeVisible();
  await expect(page.getByText("项目状态分布", { exact: true })).toBeVisible();

  const drawStartMs = Date.now();
  await page.waitForTimeout(3_200);

  await smoothScrollTo(page, "30 天注册来源");
  await expect(page.getByText(/共 \d+ 人 · 邀请 \d+ · 开放 \d+/)).toBeVisible();
  await page.waitForTimeout(2_800);

  await smoothScrollTo(page, "ML 后端 · 预测成本");
  await expect(page.getByText("3 / 3 在线", { exact: true })).toBeVisible();
  await expect(page.getByText("18,640", { exact: true })).toBeVisible();
  await expect(page.getByText("P95 182 ms", { exact: true })).toBeVisible();
  await page.waitForTimeout(3_000);

  await smoothScrollTo(page, "近期审计活动");
  await expect(page.getByText("更新项目", { exact: true })).toBeVisible();
  await expect(page.getByText("触发 AI 预标注", { exact: true })).toBeVisible();
  await page.waitForTimeout(3_200);

  await smoothScrollTo(page, "全平台项目");
  await expect(page.getByText("道路车辆精标", { exact: true })).toBeVisible();
  await expect(page.getByText("城市公交多目标追踪", { exact: true })).toBeVisible();
  await expect(page.getByText("园区点云障碍物", { exact: true })).toBeVisible();
  await page.waitForTimeout(4_000);

  return { drawStartMs, drawEndMs: Date.now() };
}
