/**
 * 流程录制：按目标外观选择点、正负点或整车框，分别演示三种追踪种子。
 */
import type { Page, Response } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  mediaBbox,
  mediaPoint,
  movePointerAtRefreshRate,
  normalizedBboxIoU,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";
import type { NormalizedBbox } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export type VideoMultiSeedVariant = "cross-frame-points" | "positive-negative" | "box-seed";

const VARIANT_LABELS: Record<VideoMultiSeedVariant, string> = {
  "cross-frame-points": "跨帧多正点",
  "positive-negative": "正负点修正",
  "box-seed": "整车框种子",
};

function assertAcceptedTracksCoverTargets(
  payload: unknown,
  targetClass: string,
  expectedTargets: Array<[number, number, number, number]>,
  variant: VideoMultiSeedVariant,
): void {
  if (!Array.isArray(payload)) {
    throw new Error(`[video-multi-seed:${variant}] 标注刷新没有返回数组`);
  }
  const tracks: Array<{
    frameZero: NormalizedBbox;
    keyframes: Array<{ frameIndex: number; bbox: NormalizedBbox }>;
  }> = [];
  for (const item of payload) {
    if (
      typeof item !== "object" ||
      item === null ||
      (item as Record<string, unknown>).class_name !== targetClass
    ) {
      continue;
    }
    const geometry = (item as Record<string, unknown>).geometry;
    if (typeof geometry !== "object" || geometry === null) continue;
    const keyframes = (geometry as Record<string, unknown>).keyframes;
    if (!Array.isArray(keyframes) || keyframes.length < 24) {
      throw new Error(
        `[video-multi-seed:${variant}] ${targetClass} 轨迹有效关键帧不足: ` +
          `${Array.isArray(keyframes) ? keyframes.length : 0}`,
      );
    }
    const parsedKeyframes = keyframes.flatMap((keyframe) => {
      if (typeof keyframe !== "object" || keyframe === null) return [];
      const record = keyframe as Record<string, unknown>;
      const frameIndex = record.frame_index;
      const bbox = record.bbox;
      if (typeof frameIndex !== "number" || typeof bbox !== "object" || bbox === null) {
        return [];
      }
      return [{ frameIndex, bbox: bbox as NormalizedBbox }];
    });
    const frameZero = parsedKeyframes.find((keyframe) => keyframe.frameIndex === 0);
    if (frameZero) tracks.push({ frameZero: frameZero.bbox, keyframes: parsedKeyframes });
  }
  if (tracks.length < expectedTargets.length) {
    throw new Error(
      `[video-multi-seed:${variant}] 接受后仅有 ${tracks.length}/${expectedTargets.length} 条有效 ${targetClass} 轨迹`,
    );
  }

  const unmatched = new Set(tracks.map((_, index) => index));
  for (const expected of expectedTargets) {
    const expectedBbox = {
      x: expected[0],
      y: expected[1],
      w: expected[2] - expected[0],
      h: expected[3] - expected[1],
    };
    let bestIndex = -1;
    let bestOverlap = 0;
    for (const index of unmatched) {
      const overlap = normalizedBboxIoU(tracks[index]!.frameZero, expectedBbox);
      if (overlap > bestOverlap) {
        bestIndex = index;
        bestOverlap = overlap;
      }
    }
    if (bestIndex < 0 || bestOverlap < 0.6) {
      throw new Error(
        `[video-multi-seed:${variant}] 双目标结果只命中局部或漏掉目标主体: ` +
          `bestIoU=${bestOverlap.toFixed(3)}, expected=${JSON.stringify(expectedBbox)}, ` +
          `actual=${JSON.stringify(tracks)}`,
      );
    }
    const acceptedTrack = tracks[bestIndex]!;
    const minimumWidth = expectedBbox.w * 0.62;
    const minimumHeight = expectedBbox.h * 0.62;
    for (const frameIndex of [4, 15, 30]) {
      const keyframe = acceptedTrack.keyframes.find((item) => item.frameIndex === frameIndex);
      if (!keyframe) continue;
      if (keyframe.bbox.w < minimumWidth || keyframe.bbox.h < minimumHeight) {
        throw new Error(
          `[video-multi-seed:${variant}] ${targetClass} 轨迹在 F${frameIndex} 缩成局部目标: ` +
            `expected>=${minimumWidth.toFixed(3)}×${minimumHeight.toFixed(3)}, ` +
            `actual=${keyframe.bbox.w.toFixed(3)}×${keyframe.bbox.h.toFixed(3)}`,
        );
      }
    }
    unmatched.delete(bestIndex);
  }
}

async function moveToFrame(page: Page, timeline: ReturnType<Page["getByTestId"]>, frame: number) {
  await timeline.focus();
  const key = frame > 0 ? "ArrowRight" : "ArrowLeft";
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(170);
  }
  await page.getByText(new RegExp(`^F ${frame} \\/ `)).waitFor({ timeout: 3_000 });
}

async function moveTrackerPanelToLeft(
  page: Page,
  dialog: ReturnType<Page["getByTestId"]>,
): Promise<void> {
  const panelBox = await dialog.boundingBox();
  const header = dialog.getByTestId("tracker-panel-header");
  const headerBox = await header.boundingBox();
  if (!panelBox || !headerBox) {
    throw new Error("[video-multi-seed] 追踪面板不可见，无法为右侧目标让出画布");
  }
  const from = { x: headerBox.x + headerBox.width * 0.5, y: headerBox.y + headerBox.height * 0.5 };
  const to = { x: from.x + 8 - panelBox.x, y: from.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, from, to, 700);
  await page.mouse.up();
  const movedBox = await dialog.boundingBox();
  if (!movedBox || movedBox.x > 80) {
    throw new Error(`[video-multi-seed] 追踪面板没有移动到左侧: x=${movedBox?.x ?? "missing"}`);
  }
  await page.waitForTimeout(400);
}

async function scrubPendingTrackerFrames(
  page: Page,
  timeline: ReturnType<Page["getByTestId"]>,
): Promise<void> {
  const box = await timeline.boundingBox();
  if (!box) throw new Error("[video-multi-seed] 时间轴不可见，无法展示跨帧候选");
  const y = box.y + box.height * 0.5;
  const frameZero = { x: box.x + 2, y };
  const laterFrame = { x: box.x + box.width * 0.38, y };
  const reviewFrame = { x: box.x + box.width * 0.14, y };

  await page.mouse.move(frameZero.x, frameZero.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, frameZero, laterFrame, 2_200);
  await page.mouse.up();
  await page.getByText(/^F 2[5-9] \/ 71$/).waitFor({ timeout: 3_000 });
  await page.waitForTimeout(900);

  await page.mouse.down();
  await movePointerAtRefreshRate(page, laterFrame, reviewFrame, 1_800);
  await page.mouse.up();
  await page.getByText(/^F (?:9|10|11) \/ 71$/).waitFor({ timeout: 3_000 });
  await page.waitForTimeout(1_000);
}

export async function runVideoMultiSeedTracking(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  variant: VideoMultiSeedVariant,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  const label = VARIANT_LABELS[variant];
  await page.evaluate(() => {
    // 先在右侧面板下播种左侧公交车，再把面板拖到左侧播种右侧公交车。
    localStorage.setItem("wb:video-tracker-panel-position", JSON.stringify({ left: 860, top: 8 }));
    localStorage.removeItem("wb:video-tracker-panel-size");
  });
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const stage = page.getByTestId("video-konva-stage");
  const timeline = page.getByTestId("video-timeline-shell");
  await timeline.waitFor({ timeout: 15_000 });
  await stage.waitFor({ timeout: 10_000 });
  await page.addStyleTag({
    content: '[data-testid="video-frame-preview-popover"] { display: none !important; }',
  });
  await page.waitForTimeout(700);

  const drawStartMs = Date.now();
  await page.getByTestId("workbench-ai-tracker").click();
  const dialog = page.getByTestId("video-tracker-propagate-dialog");
  await dialog.waitFor({ timeout: 5_000 });

  const modelSelect = dialog.locator("#tracker-model");
  const modelValues = await modelSelect
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const seedModel = ["sam3_video_interactive", "sam2_video"].find((value) =>
    modelValues.includes(value),
  );
  if (!seedModel) throw new Error(`[video-multi-seed:${variant}] 没有可用的交互式视频模型`);
  await modelSelect.selectOption(seedModel);

  const leftBusFrameZero = recordingAnchor(catalog, "video_demo", "tracking", "left_bus_f0", 0);
  const leftBusFrameFour = recordingAnchor(catalog, "video_demo", "tracking", "left_bus_f4", 4);
  const rightBusFrameZero = recordingAnchor(catalog, "video_demo", "tracking", "right_bus_f0", 0);
  const rightBusFrameFour = recordingAnchor(catalog, "video_demo", "tracking", "right_bus_f4", 4);
  const targets = [
    { frameZero: leftBusFrameZero, frameFour: leftBusFrameFour },
    { frameZero: rightBusFrameZero, frameFour: rightBusFrameFour },
  ];
  if (targets.some((target) => !target.frameFour.negative_point)) {
    throw new Error(`[video-multi-seed:${variant}] 双目标 F4 锚点缺少负点`);
  }
  if (targets.some((target) => target.frameZero.label !== leftBusFrameZero.label)) {
    throw new Error(`[video-multi-seed:${variant}] 同次多目标追踪不能混用不同类别`);
  }
  await dialog.getByTestId("tracker-target-class").selectOption(leftBusFrameZero.label);

  const toggle = page.getByTestId("tracker-seed-toggle");
  const media = await renderedMediaBounds(stage);
  if (variant === "box-seed") {
    await page.getByTestId("tracker-seed-mode-box").click();
  }
  for (const [index, target] of targets.entries()) {
    const targetId = index + 1;
    if (targetId > 1) {
      await dialog.getByTestId("tracker-seed-new-target").click();
      await moveTrackerPanelToLeft(page, dialog);
    }

    await toggle.click();
    if (variant === "box-seed") {
      const targetBox = mediaBbox(media, target.frameZero.bbox);
      await page.mouse.move(targetBox.start.x, targetBox.start.y);
      await page.mouse.down();
      await movePointerAtRefreshRate(page, targetBox.start, targetBox.end, 700);
      await page.mouse.up();
      await page.waitForTimeout(650);
    } else {
      for (const normalizedPoint of [
        target.frameZero.point,
        ...target.frameZero.additional_points,
      ]) {
        const point = mediaPoint(media, normalizedPoint);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(450);
      }
    }
    await toggle.click();

    const targetSummary = page.getByTestId(`tracker-seed-target-${targetId}`);
    if (variant === "box-seed") {
      await targetSummary
        .filter({ hasText: "1 框" })
        .filter({ hasText: "F0" })
        .waitFor({ timeout: 3_000 });
      continue;
    }

    await moveToFrame(page, timeline, 4);
    await toggle.click();
    for (const normalizedPoint of [target.frameFour.point, ...target.frameFour.additional_points]) {
      const positive = mediaPoint(media, normalizedPoint);
      await page.mouse.click(positive.x, positive.y);
      await page.waitForTimeout(450);
    }

    if (variant === "positive-negative") {
      const negative = mediaPoint(media, target.frameFour.negative_point!);
      await page.keyboard.down("Alt");
      await page.mouse.click(negative.x, negative.y);
      await page.keyboard.up("Alt");
      await dialog.getByTestId("tracker-panel-header").hover();
      await page.waitForTimeout(900);
    }

    await toggle.click();
    const positivePointCount =
      2 + target.frameZero.additional_points.length + target.frameFour.additional_points.length;
    await targetSummary
      .filter({ hasText: "F0、F4" })
      .filter({ hasText: `${positivePointCount + (variant === "positive-negative" ? 1 : 0)} 点` })
      .waitFor({ timeout: 3_000 });
    await moveToFrame(page, timeline, 0);
  }
  await page.waitForTimeout(900);

  const serverErrors: string[] = [];
  const collectServerError = (response: Response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  };
  page.on("response", collectServerError);
  try {
    await dialog.getByRole("button", { name: "开始发现" }).click();
    const review = page.getByTestId("video-tracker-review-bar");
    await review.waitFor({ state: "visible", timeout: 120_000 });
    await review.getByText(/当前选区 62 个候选/).waitFor({ timeout: 5_000 });
    await page.waitForTimeout(1_200);
    await scrubPendingTrackerFrames(page, timeline);
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
    assertAcceptedTracksCoverTargets(
      await annotationsResponse.json(),
      leftBusFrameZero.label,
      targets.map((target) => target.frameZero.bbox),
      variant,
    );
    await review.waitFor({ state: "hidden", timeout: 5_000 });
    await page.waitForTimeout(1_200);
  } finally {
    page.off("response", collectServerError);
  }
  if (serverErrors.length > 0) {
    throw new Error(
      `[video-multi-seed:${variant}] ${label}接受后出现服务端错误: ${serverErrors.join(", ")}`,
    );
  }
  return { drawStartMs, drawEndMs: Date.now() };
}
