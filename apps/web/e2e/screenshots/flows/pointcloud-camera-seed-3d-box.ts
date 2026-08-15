/**
 * 高清母版：在放大的相机图上圈定经复核的前景物体，由真实标定与点云视锥拟合生成 3D 框，
 * 再回到主点云与三视图核对。该能力是几何辅助种框，不依赖 ML 后端，也不存在候选采纳步骤。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate, recordingAnchor } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export interface PointcloudCameraSeedResult extends DrawWindow {
  created: { taskId: string; annotationId: string };
  geometry: {
    type: string;
    center: number[];
    size: number[];
    rotation: number[];
  };
}

interface CreatedPointcloudAnnotation {
  id: string;
  task_id: string;
  annotation_type: string;
  class_name: string;
  geometry: PointcloudCameraSeedResult["geometry"];
}

function normalizedRect(
  box: { x: number; y: number; width: number; height: number },
  bbox: [number, number, number, number],
) {
  return {
    start: { x: box.x + box.width * bbox[0], y: box.y + box.height * bbox[1] },
    end: { x: box.x + box.width * bbox[2], y: box.y + box.height * bbox[3] },
  };
}

export async function runPointcloudCameraSeed3dBox(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<PointcloudCameraSeedResult> {
  const project = catalog.projects.pointcloud_demo;
  const task = project.tasks.frame_000;
  const anchor = recordingAnchor(catalog, "pointcloud_demo", "frame_000", "foreground_object");
  const annotationPath = `/api/v1/tasks/${task.id}/annotations`;
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  await page.waitForLoadState("domcontentloaded");

  await page.getByTestId("pc-viewport").waitFor({ timeout: 20_000 });
  const expandCamera = page.getByTitle("展开相机").first();
  await page
    .locator('[title="展开相机"], [title="放大相机"]')
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  if (await expandCamera.isVisible()) await expandCamera.click();
  const cameraImage = page.locator("[data-floating-panel] img").first();
  await expect(cameraImage).toBeVisible({ timeout: 10_000 });
  await cameraImage.evaluate(async (image: HTMLImageElement) => {
    if (image.complete && image.naturalWidth > 0) return;
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("相机图加载失败")), { once: true });
    });
  });
  await page.waitForTimeout(4_000);

  const drawStartMs = Date.now();
  await page.waitForTimeout(1_400);

  await page.getByTitle("放大相机").first().click();
  const seedButton = page.getByRole("button", { name: "种框 ⊹" });
  await seedButton.waitFor({ state: "visible", timeout: 5_000 });
  const modalBody = page.getByRole("button", { name: "关闭 ✕" }).locator("..");
  await page.waitForTimeout(1_200);
  await seedButton.click();

  const cameraCanvas = modalBody.locator('canvas[aria-label^="front 相机投影"]');
  await expect(cameraCanvas).toBeVisible();
  const box = await cameraCanvas.boundingBox();
  if (!box) throw new Error("[pointcloud-camera-seed-3d-box] 放大相机画布不可见");
  const rect = normalizedRect(box, anchor.bbox);

  await page.mouse.move(rect.start.x, rect.start.y);
  await page.waitForTimeout(450);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, rect.start, rect.end, 950);
  await page.waitForTimeout(300);
  const createdResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === annotationPath &&
      response.status() === 201,
    { timeout: 10_000 },
  );
  await page.mouse.up();

  const createdResponse = await createdResponsePromise;
  const created = (await createdResponse.json()) as CreatedPointcloudAnnotation;
  if (
    created.task_id !== task.id ||
    created.annotation_type !== "box_3d" ||
    created.class_name !== anchor.label ||
    created.geometry.type !== "box_3d" ||
    ![...created.geometry.center, ...created.geometry.size, ...created.geometry.rotation].every(
      Number.isFinite,
    ) ||
    created.geometry.size.some((value) => value <= 0)
  ) {
    throw new Error(
      `[pointcloud-camera-seed-3d-box] 3D 框落库结果无效: ${JSON.stringify(created)}`,
    );
  }

  await expect(page.locator(`[data-testid="box-list-item-${created.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.waitForTimeout(2_200);

  await page.getByRole("button", { name: "关闭 ✕" }).click();
  await expect(page.getByRole("button", { name: "种框 ⊹" })).toBeHidden();
  await page.waitForTimeout(1_200);

  await page.getByLabel("展开三视图精修(可拖动)").click();
  await expect(page.getByText("俯视 Top", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2_200);

  const viewport = page.getByTestId("pc-viewport");
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) throw new Error("[pointcloud-camera-seed-3d-box] 点云视口不可见");
  const orbitStart = {
    x: viewportBox.x + viewportBox.width * 0.34,
    y: viewportBox.y + viewportBox.height * 0.55,
  };
  const orbitEnd = {
    x: viewportBox.x + viewportBox.width * 0.45,
    y: viewportBox.y + viewportBox.height * 0.48,
  };
  await page.mouse.move(orbitStart.x, orbitStart.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, orbitStart, orbitEnd, 700);
  await page.mouse.up();
  await page.waitForTimeout(2_500);

  // 回到同步相机图完成因果闭环：初始 2D 提示已生成真实 3D 框，
  // 核对空间包围后，最后再展示该框稳定重投影到原目标。
  await page.getByTitle("放大相机").first().click();
  await expect(page.getByRole("button", { name: "关闭 ✕" })).toBeVisible();
  await expect(page.getByRole("button", { name: "种框 ⊹" })).toBeVisible();
  await page.waitForTimeout(2_800);
  await page.getByRole("button", { name: "关闭 ✕" }).click();
  await page.waitForTimeout(1_200);

  return {
    drawStartMs,
    drawEndMs: Date.now(),
    created: { taskId: task.id, annotationId: created.id },
    geometry: created.geometry,
  };
}
