/** 高清母版：视频追踪任务的执行、候选审阅状态与返回工作台入口。 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

const pointerByPage = new WeakMap<Page, { x: number; y: number }>();

async function moveTo(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("[video-tracker-job-states] 目标控件不可见");
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await movePointerAtRefreshRate(page, pointerByPage.get(page) ?? { x: 90, y: 110 }, target, 320);
  pointerByPage.set(page, target);
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function installVideoJobFixture(page: Page, catalog: ScreenshotSeedCatalog): Promise<void> {
  const project = catalog.projects.video_demo;
  const taskId = project.tasks.tracking.id;
  const common = {
    task_id: taskId,
    project_id: project.id,
    project_name: "城市公交多目标追踪",
    project_display_id: project.display_id,
    dataset_item_id: "demo-video-item",
    annotation_id: null,
    segment_id: null,
    created_by: catalog.users.project_admin.id,
    model_key: "sam3_video",
    direction: "forward",
    error_message: null,
  };
  const jobs = [
    {
      ...common,
      id: "demo-video-running",
      status: "running",
      from_frame: 0,
      to_frame: 180,
      started_at: minutesAgo(1),
      completed_at: null,
      created_at: minutesAgo(1),
    },
    {
      ...common,
      id: "demo-video-pending-review",
      status: "pending_review",
      from_frame: 18,
      to_frame: 132,
      started_at: minutesAgo(7),
      completed_at: minutesAgo(5),
      created_at: minutesAgo(7),
    },
    {
      ...common,
      id: "demo-video-accepted",
      status: "accepted",
      model_key: "sam2_video",
      direction: "bidirectional",
      from_frame: 24,
      to_frame: 148,
      started_at: minutesAgo(18),
      completed_at: minutesAgo(16),
      created_at: minutesAgo(18),
    },
    {
      ...common,
      id: "demo-video-discarded",
      status: "discarded",
      model_key: "pvs_tracking",
      direction: "backward",
      from_frame: 42,
      to_frame: 96,
      started_at: minutesAgo(31),
      completed_at: minutesAgo(29),
      created_at: minutesAgo(31),
    },
  ];

  await page.route("**/api/v1/projects**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/v1/projects") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: project.id,
          name: "城市公交多目标追踪",
          display_id: project.display_id,
          data_type: "video",
        },
        {
          id: "demo-video-project-warehouse",
          name: "仓储车辆轨迹复核",
          display_id: "P-VIDEO-WH",
          data_type: "video",
        },
      ]),
    });
  });

  await page.route("**/api/v1/video-tracker-jobs**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/v1/video-tracker-jobs") {
      await route.continue();
      return;
    }
    const projectId = url.searchParams.get("project_id");
    const modelKey = url.searchParams.get("model_key");
    const status = url.searchParams.get("status");
    const base = jobs.filter(
      (job) =>
        (!projectId || job.project_id === projectId) && (!modelKey || job.model_key === modelKey),
    );
    const counts = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      pending_review: 0,
      partially_reviewed: 0,
      accepted: 0,
      discarded: 0,
    };
    base.forEach((job) => {
      counts[job.status as keyof typeof counts] += 1;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: status ? base.filter((job) => job.status === status) : base,
        next_cursor: null,
        counts,
      }),
    });
  });
}

export async function runVideoTrackerJobStates(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  await installVideoJobFixture(page, catalog);
  await page.goto("/ai-pre/jobs?tab=video");
  await expect(page.getByRole("heading", { name: "AI 任务历史" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("视频追踪任务 (4)")).toBeVisible();
  for (const label of ["运行中", "待审阅", "已采纳", "已丢弃"]) {
    await expect(page.getByRole("cell").filter({ hasText: label }).first()).toBeVisible();
  }

  const drawStartMs = Date.now();
  await page.waitForTimeout(3_000);

  const projectFilter = page.getByLabel("筛选视频项目");
  await moveTo(page, projectFilter);
  await projectFilter.selectOption(catalog.projects.video_demo.id);
  await expect(projectFilter).toContainText("城市公交多目标追踪");
  await page.waitForTimeout(2_400);

  const statusFilter = page.getByLabel("筛选视频任务状态");
  await moveTo(page, statusFilter);
  await statusFilter.selectOption("pending_review");
  const reviewRow = page.getByRole("row").filter({ hasText: "待审阅" }).last();
  await expect(reviewRow).toContainText("F18 → F132");
  await page.waitForTimeout(2_800);

  const workbenchButton = reviewRow.getByRole("button", { name: "返回视频工作台" });
  await moveTo(page, workbenchButton);
  await page.waitForTimeout(2_400);
  await workbenchButton.click();
  await page.getByTestId("video-timeline-shell").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByRole("button", { name: "返回" })).toBeVisible();
  await page.waitForTimeout(3_200);

  return { drawStartMs, drawEndMs: Date.now() };
}
