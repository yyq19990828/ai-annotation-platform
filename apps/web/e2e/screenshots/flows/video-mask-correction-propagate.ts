/**
 * 高清母版：在漂移帧用笔刷添加、橡皮扣除纠正 Mask，再以原生 Mask seed 向后续帧重传播。
 */
import type { Page, Response } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  commitPendingAnnotationClass,
  mediaPoint,
  movePointerAtRefreshRate,
  movePointerPathAtRefreshRate,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

type Point = { x: number; y: number };

async function stroke(page: Page, points: Point[], durationMs: number): Promise<void> {
  const first = points[0];
  if (!first || points.length < 2) {
    throw new Error("[video-mask-correction-propagate] 笔迹至少需要两个点");
  }
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await movePointerPathAtRefreshRate(page, points, durationMs);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function scrubCorrectionCandidates(
  page: Page,
  timeline: ReturnType<Page["getByTestId"]>,
): Promise<void> {
  const box = await timeline.boundingBox();
  if (!box) throw new Error("[video-mask-correction-propagate] 时间轴不可见");
  const y = box.y + box.height * 0.5;
  const correctionFrame = { x: box.x + box.width * 0.07, y };
  const laterFrame = { x: box.x + box.width * 0.25, y };
  const reviewFrame = { x: box.x + box.width * 0.14, y };

  await page.mouse.move(correctionFrame.x, correctionFrame.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, correctionFrame, laterFrame, 1_800);
  await page.mouse.up();
  await page.getByText(/^F 1[6-9] \/ 71$/).waitFor({ timeout: 4_000 });
  await page.waitForTimeout(1_100);

  await page.mouse.down();
  await movePointerAtRefreshRate(page, laterFrame, reviewFrame, 1_300);
  await page.mouse.up();
  await page.getByText(/^F (?:9|10|11) \/ 71$/).waitFor({ timeout: 4_000 });
  await page.waitForTimeout(1_100);
}

function assertUpdatedMaskTrack(payload: unknown, annotationId: string): void {
  if (!Array.isArray(payload)) {
    throw new Error("[video-mask-correction-propagate] 标注刷新没有返回数组");
  }
  const annotation = payload.find(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      String((item as Record<string, unknown>).id) === annotationId,
  ) as Record<string, unknown> | undefined;
  if (!annotation) {
    throw new Error("[video-mask-correction-propagate] 纠错后原 Mask 轨迹消失");
  }
  const geometry = annotation.geometry;
  if (
    typeof geometry !== "object" ||
    geometry === null ||
    (geometry as Record<string, unknown>).type !== "video_track_mask"
  ) {
    throw new Error("[video-mask-correction-propagate] 纠错结果不再是视频 Mask 轨迹");
  }
  const keyframes = (geometry as Record<string, unknown>).keyframes;
  if (!Array.isArray(keyframes)) {
    throw new Error("[video-mask-correction-propagate] 纠错轨迹缺少关键帧");
  }
  const manualFrames = keyframes
    .filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).source === "manual",
    )
    .map((item) => Number((item as Record<string, unknown>).frame_index));
  const predictionFrames = keyframes
    .filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).source === "prediction",
    )
    .map((item) => Number((item as Record<string, unknown>).frame_index));
  if (!manualFrames.includes(0) || !manualFrames.includes(5)) {
    throw new Error(
      `[video-mask-correction-propagate] F0/F5 人工关键帧不完整: ${manualFrames.join(",")}`,
    );
  }
  if (predictionFrames.length < 8 || !predictionFrames.every((frame) => frame > 5)) {
    throw new Error(
      "[video-mask-correction-propagate] 后续纠错候选没有写回原轨迹: " + predictionFrames.join(","),
    );
  }
}

export async function runVideoMaskCorrectionPropagate(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const stage = page.getByTestId("video-konva-stage");
  const timeline = page.getByTestId("video-timeline-shell");
  await timeline.waitFor({ timeout: 15_000 });
  await stage.waitFor({ timeout: 10_000 });
  await page.addStyleTag({
    content: '[data-testid="video-frame-preview-popover"] { display: none !important; }',
  });
  await page.waitForTimeout(900);

  const bounds = await renderedMediaBounds(stage);
  const initial = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f0", 0);
  const drift = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f5", 5);
  if (initial.label !== "truck" || drift.label !== initial.label) {
    throw new Error("[video-mask-correction-propagate] 纠错锚点不是同一辆卡车");
  }
  if (initial.brush_strokes.length === 0) {
    throw new Error("[video-mask-correction-propagate] 初始卡车缺少 Mask 笔刷锚点");
  }

  // 录制窗口外创建一条有意带漏分与右侧外溢的 F0 Mask；正式母版从 F5 错误边界开始。
  await page.getByTestId("video-tool-btn-mask-track").click();
  const toolbar = page.getByTestId("mask-toolbar");
  await toolbar.waitFor({ timeout: 10_000 });
  const initialPath = initial.brush_strokes.flatMap((path, index) => {
    const points = path.map((point) => mediaPoint(bounds, point));
    return index % 2 === 0 ? points : points.reverse();
  });
  await stroke(page, initialPath, 1_400);
  await stroke(
    page,
    [
      mediaPoint(bounds, [0.7, 0.52]),
      mediaPoint(bounds, [0.746, 0.52]),
      mediaPoint(bounds, [0.746, 0.72]),
      mediaPoint(bounds, [0.7, 0.72]),
    ],
    650,
  );
  const confirmed = toolbar.getByTitle("确认 (Enter)");
  await confirmed.waitFor({ state: "visible", timeout: 10_000 });
  await confirmed.click();
  await commitPendingAnnotationClass(page, {
    label: initial.label,
    taskId: project.tasks.tracking.id,
  });
  await toolbar.waitFor({ state: "hidden", timeout: 15_000 });

  const trackRow = page.locator('[data-testid^="video-mask-track-"]').last();
  await trackRow.waitFor({ timeout: 15_000 });
  const testId = await trackRow.getAttribute("data-testid");
  const annotationId = testId?.replace("video-mask-track-", "");
  if (!annotationId) {
    throw new Error("[video-mask-correction-propagate] 无法读取初始 Mask 轨迹 ID");
  }
  const collapseSelection = page.getByRole("button", { name: "收起浮窗" });
  await collapseSelection.waitFor({ state: "visible", timeout: 5_000 });
  await collapseSelection.click();
  for (let frame = 0; frame < 5; frame += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
  }
  await page
    .getByText(/保持 F0/)
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(700);

  const serverErrors: string[] = [];
  const collectServerError = (response: Response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  };
  page.on("response", collectServerError);
  const drawStartMs = Date.now();
  try {
    await page.waitForTimeout(1_200);
    await page.getByLabel(/展开选中信息卡.*可拖动/).click();
    await page.getByTitle("编辑当前帧 Mask").click();
    await toolbar.waitFor({ timeout: 10_000 });
    const collapseEditorSelection = page.getByRole("button", { name: "收起浮窗" });
    if (await collapseEditorSelection.isVisible()) await collapseEditorSelection.click();
    await toolbar.getByTitle("笔刷 (B)").click();
    await stroke(
      page,
      [
        mediaPoint(bounds, [0.49, 0.38]),
        mediaPoint(bounds, [0.69, 0.38]),
        mediaPoint(bounds, [0.69, 0.43]),
        mediaPoint(bounds, [0.485, 0.43]),
        mediaPoint(bounds, [0.49, 0.48]),
        mediaPoint(bounds, [0.695, 0.48]),
      ],
      1_250,
    );
    await page.waitForTimeout(800);

    await toolbar.getByTitle("橡皮 (E)").click();
    await page.waitForTimeout(450);
    await stroke(
      page,
      [mediaPoint(bounds, [0.742, 0.49]), mediaPoint(bounds, [0.742, 0.75])],
      1_050,
    );
    await page.waitForTimeout(900);

    await toolbar.getByRole("button", { name: "保存并传播" }).click();
    const correctionDialog = page.getByRole("dialog", { name: "保存 Mask 纠错帧" });
    await correctionDialog.waitFor({ state: "visible", timeout: 5_000 });
    await correctionDialog.getByText(/原生 Mask seed/).waitFor({ timeout: 5_000 });
    await page.waitForTimeout(900);
    await correctionDialog.getByRole("radio", { name: "更晚帧 →" }).click();
    await correctionDialog.getByText(/生效窗口 F5–F20/).waitFor({ timeout: 3_000 });
    await page.waitForTimeout(1_100);

    const keyframeSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response
          .url()
          .endsWith(
            `/tasks/${project.tasks.tracking.id}/video/tracks/${annotationId}/mask-keyframes/5`,
          ) &&
        response.ok(),
      { timeout: 25_000 },
    );
    const jobCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(
            `/tasks/${project.tasks.tracking.id}/video/tracks/${annotationId}/correction-jobs`,
          ) &&
        response.status() === 202,
      { timeout: 25_000 },
    );
    await correctionDialog.getByRole("button", { name: "保存并启动传播" }).click();
    await Promise.all([keyframeSaved, jobCreated]);

    const review = page.getByRole("dialog", { name: "Mask 纠错候选审阅" });
    await review.waitFor({ state: "visible", timeout: 120_000 });
    await expectCorrectionSummary(review);
    await review.getByText(/当前选区 \d+ 个候选/).waitFor({ timeout: 5_000 });
    await page.waitForTimeout(1_200);

    await scrubCorrectionCandidates(page, timeline);

    const accepted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/decisions") &&
        response.ok(),
      { timeout: 20_000 },
    );
    const annotationsRefreshed = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith(`/tasks/${project.tasks.tracking.id}/annotations`) &&
        response.ok(),
      { timeout: 20_000 },
    );
    await review.getByTestId("tracker-review-accept").click();
    const [, annotationsResponse] = await Promise.all([accepted, annotationsRefreshed]);
    assertUpdatedMaskTrack(await annotationsResponse.json(), annotationId);
    await review.waitFor({ state: "hidden", timeout: 8_000 });
    // 采纳后切一帧再返回，展示正式轨迹 Mask；等待 Konva 的 Mask 与标签层都完成重绘，
    // 防止旧 ImageBitmap 阻塞同帧队列后把“保持 F0”残影录进母版。
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(450);
    await page.keyboard.press("ArrowLeft");
    const canvasSettled = await page.waitForFunction(
      () => {
        const runtime = (
          window as typeof window & {
            Konva?: {
              stages?: Array<{
                getLayers: () => Array<{ name: () => string; _waitingForDraw?: boolean }>;
                find: (selector: string) => Array<{
                  text?: () => string;
                  image?: () => { width?: number; height?: number };
                  getLayer: () => { name: () => string } | null;
                }>;
              }>;
            };
          }
        ).Konva;
        const stage = runtime?.stages?.[0];
        if (!stage) return false;
        const currentLabelVisible = stage
          .find("Text")
          .some((node) => node.getLayer()?.name() === "overlay" && node.text?.() === "#1 · truck");
        const canvasLayersSettled = stage
          .getLayers()
          .filter((layer) =>
            ["video-mask-layer", "overlay", "ai", "interaction"].includes(layer.name()),
          )
          .every((layer) => !layer._waitingForDraw);
        const maskVisible = stage.find(".raster-mask-fill").some((node) => {
          const image = node.image?.();
          return (image?.width ?? 0) > 0 && (image?.height ?? 0) > 0;
        });
        return currentLabelVisible && canvasLayersSettled && maskVisible;
      },
      null,
      { timeout: 10_000 },
    );
    await canvasSettled.dispose();
    await page.waitForTimeout(900);
  } finally {
    page.off("response", collectServerError);
  }

  if (serverErrors.length > 0) {
    throw new Error(
      `[video-mask-correction-propagate] 纠错与传播期间出现服务端错误: ${serverErrors.join(", ")}`,
    );
  }
  return { drawStartMs, drawEndMs: Date.now() };
}

async function expectCorrectionSummary(review: ReturnType<Page["getByRole"]>): Promise<void> {
  const summary = review.getByTestId("tracker-review-correction-summary");
  await summary.waitFor({ state: "visible", timeout: 5_000 });
  const text = (await summary.textContent()) ?? "";
  for (const expected of ["F5 人工纠错帧", "向更晚帧", "原生 Mask seed", "保护人工帧"]) {
    if (!text.includes(expected)) {
      throw new Error(`[video-mask-correction-propagate] 纠错摘要缺少“${expected}”：${text}`);
    }
  }
}
