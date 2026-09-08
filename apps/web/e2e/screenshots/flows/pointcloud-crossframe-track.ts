/**
 * 高清母版：将已复核的 3D 框延续到两个相邻帧，在中间帧修正位置，
 * 再核对同一 track_id 的邻帧参考框。该能力是确定性跨帧延续，不依赖 ML 后端。
 */
import { expect, type Page, type Response } from "@playwright/test";
import type { ScreenshotSeedCatalog, SeedTaskAnnotation } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";
import {
  installRecordingWorkbenchLayout,
  waitForRecordingWorkbenchLayout,
} from "./_workbench-layout";

interface PropagateResponseBody {
  annotation: SeedTaskAnnotation;
  motion_compensated: boolean;
}

export interface PointcloudCrossframeTrackResult extends DrawWindow {
  created: Array<{ taskId: string; annotationId: string }>;
  trackId: string;
}

function propagateResponse(page: Page, sourceTaskId: string, annotationId: string) {
  const path = `/api/v1/tasks/${sourceTaskId}/annotations/${annotationId}/propagate-to-task`;
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path &&
      response.status() === 201,
    { timeout: 15_000 },
  );
}

async function parsePropagation(
  response: Response,
  targetTaskId: string,
  expectedTrackId?: string,
): Promise<PropagateResponseBody> {
  const body = (await response.json()) as PropagateResponseBody;
  if (
    body.annotation.task_id !== targetTaskId ||
    body.annotation.annotation_type !== "box_3d" ||
    body.annotation.geometry.type !== "box_3d" ||
    !body.annotation.track_id ||
    (expectedTrackId && body.annotation.track_id !== expectedTrackId)
  ) {
    throw new Error(`[pointcloud-crossframe-track] 跨帧结果无效: ${JSON.stringify(body)}`);
  }
  return body;
}

async function selectBox(page: Page, annotationId: string) {
  const item = page.locator(`[data-testid="box-list-item-${annotationId}"]`);
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();
  await expect(item).toHaveClass(/border-brand/);
}

export async function runPointcloudCrossframeTrack(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  source: SeedTaskAnnotation,
  onCreated: (created: { taskId: string; annotationId: string }) => void,
): Promise<PointcloudCrossframeTrackResult> {
  const project = catalog.projects.pointcloud_demo;
  const frame0 = project.tasks.frame_000;
  const frame1 = project.tasks.frame_001;
  const frame2 = project.tasks.frame_002;
  const created: PointcloudCrossframeTrackResult["created"] = [];

  await installRecordingWorkbenchLayout(page, "both", {
    workspace: { context: "annotate:3d", preset: "standard" },
  });

  // 录制窗口外预热后续两帧的 manifest 与 PCD：跨帧操作依然发生真实导航，
  // 但不把首次资源解析的骨架屏、短暂旧 manifest 绘制录进宣传母版。
  for (const task of [frame2, frame1]) {
    await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("pc-viewport").waitFor({ timeout: 20_000 });
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
  }

  await page.goto(`/projects/${project.id}/annotate?task=${frame0.id}`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("pc-viewport").waitFor({ timeout: 20_000 });
  await waitForRecordingWorkbenchLayout(page, "both");

  // 首帧点云在 viewport 出现后仍会短暂完成 manifest/PCD 上传与首帧绘制；
  // 先等到场景明确 ready，再稳定一段时间，避免把空网格录入母版。
  await expect(page.locator('[data-scene-frame-state="ready"]')).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_500);

  // 沿用产品真实的双击框聚焦路径，把目标与后续邻帧参考带到镜头中心，
  // 保证 0.2m 修正和虚线框在 1280px 文档视频中仍可辨认。
  const viewport = page.getByTestId("pc-viewport");
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) throw new Error("[pointcloud-crossframe-track] 点云视口不可见");
  await page.getByRole("button", { name: "重置视角", exact: true }).click();
  await page.waitForTimeout(1_500);
  await page.mouse.dblclick(
    viewportBox.x + viewportBox.width * 0.47,
    viewportBox.y + viewportBox.height * 0.42,
  );
  await expect(page.getByTestId("three-d-selection-panel").first()).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1_200);
  // 与 billboard 录制一致，聚焦后轻微拉远，给跨帧 ego 位姿变化留下完整构图余量。
  await page.mouse.move(
    viewportBox.x + viewportBox.width * 0.14,
    viewportBox.y + viewportBox.height * 0.19,
  );
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(700);

  await selectBox(page, source.id);
  await page.waitForTimeout(700);
  const drawStartMs = Date.now();
  await page.waitForTimeout(3_000);
  await page.waitForTimeout(1_200);

  const firstResponsePromise = propagateResponse(page, frame0.id, source.id);
  await page.keyboard.press("Shift+ArrowRight");
  const first = await parsePropagation(await firstResponsePromise, frame1.id);
  const firstCreated = { taskId: frame1.id, annotationId: first.annotation.id };
  created.push(firstCreated);
  onCreated(firstCreated);
  await expect(page).toHaveURL(new RegExp(`task=${frame1.id}`), { timeout: 15_000 });
  await expect(page.getByText("已延续到帧 1")).toBeVisible({ timeout: 10_000 });
  await selectBox(page, first.annotation.id);
  await page.waitForTimeout(2_200);

  // 中间帧做一次可见的人工位置修正，再将修正后几何延续到下一帧。
  const expandDetails = page.getByRole("button", { name: "展开详情" });
  if (await expandDetails.isVisible()) await expandDetails.click();
  const centerX = page.getByLabel("cx");
  await expect(centerX).toBeVisible();
  const updatePath = `/api/v1/tasks/${frame1.id}/annotations/${first.annotation.id}`;
  const updatePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === updatePath &&
      response.ok(),
    { timeout: 10_000 },
  );
  await centerX.click();
  await centerX.fill(String(Number(await centerX.inputValue()) + 0.2));
  await page.getByText("中心 (m)", { exact: true }).click();
  const updated = (await (await updatePromise).json()) as SeedTaskAnnotation;
  if (updated.geometry.type !== "box_3d") {
    throw new Error("[pointcloud-crossframe-track] 中间帧修正未保存为 box_3d");
  }
  await page.waitForTimeout(2_000);

  const secondResponsePromise = propagateResponse(page, frame1.id, first.annotation.id);
  await page.keyboard.press("Shift+ArrowRight");
  const second = await parsePropagation(
    await secondResponsePromise,
    frame2.id,
    first.annotation.track_id ?? undefined,
  );
  const secondCreated = { taskId: frame2.id, annotationId: second.annotation.id };
  created.push(secondCreated);
  onCreated(secondCreated);
  await expect(page).toHaveURL(new RegExp(`task=${frame2.id}`), { timeout: 15_000 });
  await expect(page.getByText("已延续到帧 2")).toBeVisible({ timeout: 10_000 });
  await selectBox(page, second.annotation.id);
  await page.waitForTimeout(3_000);

  // 回看中间帧：当前实线框 + 同 track_id 的邻帧虚线框同时可见。
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page).toHaveURL(new RegExp(`task=${frame1.id}`), { timeout: 15_000 });
  await selectBox(page, first.annotation.id);
  await page.waitForTimeout(3_200);

  // 继续回到首帧，核对源框也已获得同一轨迹身份，并参照下一帧虚线框。
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page).toHaveURL(new RegExp(`task=${frame0.id}`), { timeout: 15_000 });
  await selectBox(page, source.id);
  await page.waitForTimeout(4_500);

  return {
    drawStartMs,
    drawEndMs: Date.now(),
    created,
    trackId: first.annotation.track_id!,
  };
}
