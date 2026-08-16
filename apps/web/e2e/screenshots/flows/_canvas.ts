/**
 * canvas 流程录制共享工具。
 */
import type { Locator, Page } from "@playwright/test";
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

export interface NormalizedBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normalizedBboxIoU(left: NormalizedBbox, right: NormalizedBbox): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const union = left.w * left.h + right.w * right.h - intersection;
  return union > 0 ? intersection / union : 0;
}

export function mediaBoundsFromStageBox(stage: MediaBounds, media: MediaBounds): MediaBounds {
  return {
    x: stage.x + media.x,
    y: stage.y + media.y,
    width: media.width,
    height: media.height,
  };
}

export async function renderedMediaBounds(stage: Locator): Promise<MediaBounds> {
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error("[recording-anchor] 工作台没有可见边界");
  const values = await stage.evaluate((element) => ({
    x: Number(element.getAttribute("data-media-x")),
    y: Number(element.getAttribute("data-media-y")),
    width: Number(element.getAttribute("data-media-width")),
    height: Number(element.getAttribute("data-media-height")),
  }));
  if (
    !Number.isFinite(values.x) ||
    !Number.isFinite(values.y) ||
    !Number.isFinite(values.width) ||
    !Number.isFinite(values.height) ||
    values.width <= 0 ||
    values.height <= 0
  ) {
    throw new Error("[recording-anchor] 工作台未暴露有效的媒体渲染区");
  }
  return mediaBoundsFromStageBox(stageBox, values);
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

export async function selectActiveClass(page: Page, stage: Locator, label: string): Promise<void> {
  await stage.waitFor({ state: "visible" });
  await page.waitForFunction(
    ({ expected }) =>
      document
        .querySelector('[data-testid="workbench-stage"], [data-testid="video-konva-stage"]')
        ?.getAttribute("data-active-class") === expected,
    { expected: label },
    { timeout: 3_000 },
  );
}

const VIDEO_CLASS_SHORTCUTS: Record<string, string> = {
  car: "1",
  person: "2",
  bus: "3",
  truck: "4",
};

export async function selectVideoRecordingClass(
  page: Page,
  stage: Locator,
  label: string,
): Promise<void> {
  const shortcut = VIDEO_CLASS_SHORTCUTS[label];
  if (!shortcut) throw new Error(`[recording-class] 视频录制类别 ${label} 缺少稳定快捷键`);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(shortcut);
  await selectActiveClass(page, stage, label);
}

export async function waitForCommittedAnnotationClass(
  page: Page,
  options: { label: string; taskId: string | number },
): Promise<Record<string, unknown>> {
  const response = await page.waitForResponse(
    (candidate) =>
      isAnnotationCommitRequest(candidate.request().method(), candidate.url()) && candidate.ok(),
    { timeout: 20_000 },
  );
  const payload = committedAnnotationFromPayload(
    (await response.json()) as Record<string, unknown>,
  );
  if (payload.task_id !== options.taskId || payload.class_name !== options.label) {
    throw new Error(
      `[recording-class] 标注落库结果与语义锚点不一致：` +
        `${String(payload.task_id)}/${String(payload.class_name)}`,
    );
  }
  return payload;
}

export async function commitPendingAnnotationClass(
  page: Page,
  options: { label: string; taskId: string | number },
): Promise<Record<string, unknown>> {
  const picker = page.getByTestId("class-picker-popover");
  await picker.waitFor({ state: "visible", timeout: 10_000 });
  const saved = waitForCommittedAnnotationClass(page, options);
  await picker.getByText(options.label, { exact: true }).last().click();
  const payload = await saved;
  await picker.waitFor({ state: "hidden", timeout: 5_000 });
  return payload;
}

export function isAnnotationCommitRequest(method: string, url: string): boolean {
  return (
    method === "POST" &&
    (/\/annotations(?:\?|$)/.test(url) || /\/ai-mask-candidates\/accept(?:\?|$)/.test(url))
  );
}

export function committedAnnotationFromPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const annotation = payload.annotation;
  if (typeof annotation === "object" && annotation !== null && !Array.isArray(annotation)) {
    return annotation as Record<string, unknown>;
  }
  return payload;
}

/**
 * 用 Playwright 的可信鼠标事件按 60Hz 节拍推进拖拽。每一帧都经 page.mouse.move
 * 更新浏览器与 Playwright 共享的指针/按键状态，避免 Konva 只在松手前才跳到终点。
 */
export async function movePointerAtRefreshRate(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
  options: { shiftKey?: boolean } = {},
): Promise<void> {
  await movePointerPathAtRefreshRate(page, [from, to], durationMs, options);
}

/** 沿折线在每个浏览器刷新帧推进一次指针，适合旋转弧线等非直线路径。 */
export async function movePointerPathAtRefreshRate(
  page: Page,
  points: Array<{ x: number; y: number }>,
  durationMs: number,
  _options: { shiftKey?: boolean } = {},
): Promise<void> {
  if (points.length < 2) throw new Error("[recording-pointer] 指针路径至少需要两个点");
  const frameIntervalMs = 1000 / 60;
  const frameCount = Math.max(1, Math.round(durationMs / frameIntervalMs));
  const startedAt = performance.now();
  let emittedFrame = 0;
  while (emittedFrame < frameCount) {
    // 忙碌画布可能让一次 CDP mouse.move 超过一帧。按真实墙钟跳过已经错过的采样点，
    // 避免仍补发全部 60Hz 事件而把 1 秒手势拖成十几秒慢动作。
    const elapsedFrames = Math.floor((performance.now() - startedAt) / frameIntervalMs);
    const frame = Math.min(frameCount, Math.max(emittedFrame + 1, elapsedFrames + 1));
    const targetAt = startedAt + frame * frameIntervalMs;
    const remaining = targetAt - performance.now();
    if (remaining > 1) await new Promise((resolve) => setTimeout(resolve, remaining));
    const progress = frame / frameCount;
    const pathPosition = progress * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(pathPosition));
    const segmentProgress = pathPosition - index;
    const from = points[index]!;
    const to = points[index + 1]!;
    await page.mouse.move(
      from.x + (to.x - from.x) * segmentProgress,
      from.y + (to.y - from.y) * segmentProgress,
    );
    emittedFrame = frame;
  }
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
