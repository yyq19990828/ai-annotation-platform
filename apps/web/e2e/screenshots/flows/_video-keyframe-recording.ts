import { expect, type Page } from "@playwright/test";
import type Konva from "konva";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { TaskVideoManifestResponse } from "../../../src/types";
import { renderedMediaBounds } from "./_canvas";
import { waitForRecordingPanels } from "./_workbench-layout";
import type { DrawWindow } from "./rotated-bbox";
import type { RecordedVideoTrack, VideoRecordingBbox } from "./_video-keyframe-evidence";

export interface VideoKeyframeRecordingWindow extends DrawWindow {
  evidence: Record<string, unknown>;
}

export async function readVideoRecordingJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (path) => {
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (!response.ok) throw new Error(`[video-keyframes] ${path}: HTTP ${response.status}`);
    return response.json();
  }, path);
}

export async function collapseVideoSelectionCard(page: Page): Promise<void> {
  const collapse = page.getByRole("button", { name: "收起浮窗", exact: true });
  if (await collapse.isVisible()) await collapse.click();
}

export async function holdVideoRecording(page: Page, durationMs: number): Promise<void> {
  const bounds = await page.getByTestId("video-konva-stage").boundingBox();
  expect(bounds).toBeTruthy();
  await page.mouse.move(bounds!.x + 12, bounds!.y + 12);
  await page.waitForTimeout(durationMs);
  await expect(page.getByTestId("video-playback-overlay")).toBeVisible();
  await expect(page.getByTestId("video-playback-overlay")).toHaveCSS("opacity", "1");
}

export async function setVideoRecordingTimeline(page: Page, expanded: boolean): Promise<void> {
  await holdVideoRecording(page, 100);
  const toggle = page.getByRole("button", {
    name: expanded ? "展开时间轴详情" : "收起时间轴详情",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.getByTestId("video-playback-overlay")).toHaveAttribute(
    "data-state",
    expanded ? "expanded" : "collapsed",
  );
}

export async function openVideoKeyframeRecording(page: Page, catalog: ScreenshotSeedCatalog) {
  const project = catalog.projects.video_demo;
  const taskId = project.tasks.tracking.id;
  await page.goto(`/projects/${project.id}/annotate?task=${taskId}`);
  await page.waitForLoadState("domcontentloaded");
  expect(new URL(page.url()).searchParams.get("task")).toBe(taskId);
  await expect(page.getByTestId("video-timeline-shell")).toBeVisible({ timeout: 20_000 });
  for (const title of ["类别面板", "标注详情"]) {
    await page
      .getByRole("tab")
      .filter({ has: page.getByRole("button", { name: `隐藏${title}`, exact: true }) })
      .click();
  }
  await waitForRecordingPanels(
    page,
    ["canvas", "class-palette", "inspector"],
    ["discussion", "ai-task", "video-tracker"],
  );
  await page.getByRole("button", { name: "全部", exact: true }).click();
  const manifest = await readVideoRecordingJson<TaskVideoManifestResponse>(
    page,
    `/api/v1/tasks/${taskId}/video/manifest`,
  );
  expect(manifest.task_id).toBe(taskId);
  expect(manifest.metadata.width).toBeGreaterThan(0);
  expect(manifest.metadata.height).toBeGreaterThan(0);
  expect(manifest.metadata.fps).toBeGreaterThan(0);
  expect(manifest.metadata.frame_count).toBeGreaterThan(8);
  const source = page.getByTestId("video-konva-source");
  await expect
    .poll(() => source.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect(source).toHaveJSProperty("videoWidth", manifest.metadata.width!);
  await expect(source).toHaveJSProperty("videoHeight", manifest.metadata.height!);
  const currentSrc = await source.evaluate((video: HTMLVideoElement) => video.currentSrc);
  expect(new URL(currentSrc).pathname).toBe(new URL(manifest.video_url, page.url()).pathname);
  if (!(await source.evaluate((video: HTMLVideoElement) => video.paused))) {
    await page.getByRole("button", { name: "播放 / 暂停", exact: true }).click();
  }
  // Keep the draw endpoints clear; expand the timeline after the manual edits.
  await setVideoRecordingTimeline(page, true);
  await page.getByRole("button", { name: "回到首帧", exact: true }).click();
  await waitForVideoRecordingFrame(page, manifest, 0);
  await setVideoRecordingTimeline(page, false);
  await collapseVideoSelectionCard(page);
  const baseline = await readVideoRecordingJson<RecordedVideoTrack[]>(
    page,
    `/api/v1/tasks/${taskId}/annotations`,
  );
  expect(
    baseline,
    "These two manual-track demonstrations require the isolated empty tracking task",
  ).toEqual([]);
  return { taskId, manifest, stage: page.getByTestId("video-konva-stage") };
}

export async function waitForVideoRecordingFrame(
  page: Page,
  manifest: TaskVideoManifestResponse,
  frame: number,
): Promise<void> {
  const stage = page.getByTestId("video-konva-stage");
  await expect(stage).toHaveAttribute("data-video-frame-index", String(frame), { timeout: 15_000 });
  const source = page.getByTestId("video-konva-source");
  await expect(source).toHaveJSProperty("paused", true);
  await expect
    .poll(() =>
      source.evaluate((video: HTMLVideoElement) => !video.seeking && video.readyState >= 2),
    )
    .toBe(true);
  if ((await stage.getAttribute("data-video-frame-source")) === "webcodecs") {
    await expect(stage).toHaveAttribute("data-video-painted-frame-index", String(frame), {
      timeout: 15_000,
    });
  } else {
    await expect
      .poll(() =>
        source.evaluate(
          (video: HTMLVideoElement, { frame, fps }) => Math.abs(video.currentTime - frame / fps),
          { frame, fps: manifest.metadata.fps! },
        ),
      )
      .toBeLessThanOrEqual(1.1 / manifest.metadata.fps!);
  }
  const media = await renderedMediaBounds(stage);
  expect(media.width / media.height).toBeCloseTo(
    manifest.metadata.width! / manifest.metadata.height!,
    2,
  );
  await expect(page.getByTestId("video-konva-playback-error")).toHaveCount(0);
}

export async function seekVideoRecordingFrame(
  page: Page,
  manifest: TaskVideoManifestResponse,
  frame: number,
): Promise<void> {
  const timeline = page.getByTestId("video-timeline-shell");
  const readout = await page.getByTestId("video-timeline-window-readout").textContent();
  const window = readout?.match(/F(\d+)–(\d+)/);
  if (!window) throw new Error(`[video-keyframes] Invalid timeline window: ${readout}`);
  const from = Number(window[1]);
  const to = Number(window[2]);
  expect(frame).toBeGreaterThanOrEqual(from);
  expect(frame).toBeLessThanOrEqual(to);
  expect(to).toBeGreaterThan(from);
  await timeline
    .getByRole("slider", { name: "视频帧时间轴", exact: true })
    .fill(String(Math.round(((frame - from) / (to - from)) * 10_000)));
  await waitForVideoRecordingFrame(page, manifest, frame);
}

/** Verify real Konva geometry and a painted stroke in its own transparent tracks layer. */
export async function waitForVideoRecordingShape(
  page: Page,
  manifest: TaskVideoManifestResponse,
  bbox: VideoRecordingBbox,
  options: { ghost?: boolean; dashed?: boolean } = {},
): Promise<void> {
  const stage = page.getByTestId("video-konva-stage");
  await expect
    .poll(
      () =>
        stage.evaluate(
          (element, { bbox, width, height, options }) => {
            const runtime = (window as unknown as { Konva?: typeof Konva }).Konva;
            const current = runtime?.stages.find((stage) => element.contains(stage.container()));
            const selector = options.ghost ? ".video-track-ghost" : ".video-track-shape";
            const node = current
              ?.find(selector)
              .find(
                (node) =>
                  node.getClassName() === "Rect" &&
                  node.isVisible() &&
                  Math.abs(node.x() / width - bbox.x) <= 0.005 &&
                  Math.abs(node.y() / height - bbox.y) <= 0.005 &&
                  Math.abs(node.width() / width - bbox.w) <= 0.005 &&
                  Math.abs(node.height() / height - bbox.h) <= 0.005,
              ) as Konva.Rect | undefined;
            if (!node || (options.dashed !== undefined && !!node.dash()?.length !== options.dashed))
              return false;
            const canvas = node.getLayer()?.getCanvas()._canvas;
            if (!canvas) return false;
            const context = canvas.getContext("2d");
            const bounds = canvas.getBoundingClientRect();
            const transform = node.getAbsoluteTransform();
            const points = [
              [node.width() / 2, 0],
              [0, node.height() / 2],
              [node.width() / 2, node.height()],
            ].map(([x, y]) => transform.point({ x, y }));
            return points.some(({ x, y }) => {
              const px = Math.floor((x * canvas.width) / bounds.width);
              const py = Math.floor((y * canvas.height) / bounds.height);
              if (px < 1 || py < 1 || px + 1 >= canvas.width || py + 1 >= canvas.height)
                return false;
              const pixels = context?.getImageData(px - 1, py - 1, 3, 3).data;
              return pixels?.some((value, index) => index % 4 === 3 && value > 0);
            });
          },
          { bbox, width: manifest.metadata.width!, height: manifest.metadata.height!, options },
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

export async function readSavedVideoTracks(
  page: Page,
  taskId: string,
): Promise<RecordedVideoTrack[]> {
  return readVideoRecordingJson(page, `/api/v1/tasks/${taskId}/annotations`);
}
