/**
 * canvas 流程录制共享工具。
 */
import type { Page } from "@playwright/test";
import type {
  ScreenshotProjectKey,
  ScreenshotRecordingAnchor,
  ScreenshotSeedCatalog,
} from "../../fixtures/seed";

export interface MediaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function recordingAnchor(
  catalog: ScreenshotSeedCatalog,
  projectKey: ScreenshotProjectKey,
  taskKey: string,
  anchorKey: string,
  expectedFrameIndex?: number,
): ScreenshotRecordingAnchor {
  const anchor = catalog.projects[projectKey]?.tasks[taskKey]?.recording_anchors?.[anchorKey];
  if (!anchor) {
    throw new Error(`${projectKey}.${taskKey} 缺少 ${anchorKey} 语义锚点`);
  }
  if (expectedFrameIndex !== undefined && anchor.frame_index !== expectedFrameIndex) {
    throw new Error(
      `${projectKey}.${taskKey}.${anchorKey} 帧锚点应为 F${expectedFrameIndex}，实际为 F${anchor.frame_index ?? "?"}`,
    );
  }
  return anchor;
}

export function mediaPoint(bounds: MediaBounds, point: [number, number]) {
  return {
    x: bounds.x + bounds.width * point[0],
    y: bounds.y + bounds.height * point[1],
  };
}

export function mediaBbox(bounds: MediaBounds, bbox: [number, number, number, number]) {
  return {
    start: mediaPoint(bounds, [bbox[0], bbox[1]]),
    end: mediaPoint(bounds, [bbox[2], bbox[3]]),
  };
}

/**
 * 通过 screenshot catalog 的稳定逻辑键打开图片工作台。
 */
export async function openImageAnnotate(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  taskKey = "annotating",
): Promise<void> {
  const project = catalog.projects.image_demo;
  const task = project.tasks[taskKey];
  if (!task) throw new Error(`image_demo 缺少任务 ${taskKey}`);
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  await page.getByTestId("workbench-stage").waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * 隐藏所有预测来源（取消 AI 面板「预测来源筛选」里仍勾选且可点的来源）。
 *
 * COCO8 任务满屏 external_import 预测框，绘制工具的指针手势会落在预测框上触发
 * 「采纳/驳回」浮层而画不出新形状；先把预测隐藏，画布干净后再绘制。
 */
export async function hidePredictions(page: Page): Promise<void> {
  const card = page.locator('[aria-label="预测来源筛选"]');
  if (!(await card.count())) return;
  await card.waitFor({ timeout: 4000 });
  // 逐个取消勾选（每次取消后 :checked 集合变化，始终取第一个仍勾选且未禁用的）
  for (let i = 0; i < 4; i++) {
    const checkbox = card.locator('input[type="checkbox"]:checked:not([disabled])').first();
    if (!(await checkbox.count())) break;
    await checkbox.click();
    await page.waitForTimeout(350);
  }
}
