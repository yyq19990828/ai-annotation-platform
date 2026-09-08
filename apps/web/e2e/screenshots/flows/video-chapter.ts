/** Record a real timeline chapter draft, both resize handles, and persisted frame bounds. */
import { expect, type Page, type Response } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { VideoChapter } from "../../../src/api/videoChapters";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";
import {
  assertVideoTimelineVisible,
  currentVideoFrame,
  openVideoTimeline,
  parkVideoPointer,
} from "./_video-timeline";

export interface VideoChapterCleanupRecord {
  datasetItemId: string;
  chapterId: string;
}

export interface VideoChapterRecordingWindows {
  create: DrawWindow;
  resize: DrawWindow;
  evidence: {
    chapterId: string;
    datasetItemId: string;
    created: { start_frame: number; end_frame: number };
    resized: { start_frame: number; end_frame: number };
    currentFrame: number;
    reloadVerified: boolean;
  };
}

async function chapterResponse(response: Response): Promise<VideoChapter> {
  expect(response.ok(), `Chapter ${response.request().method()}: HTTP ${response.status()}`).toBe(
    true,
  );
  return response.json() as Promise<VideoChapter>;
}

export async function runVideoChapter(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  onCreated: (record: VideoChapterCleanupRecord) => void,
): Promise<VideoChapterRecordingWindows> {
  const maxFrame = await openVideoTimeline(page, catalog);
  const timeline = page.getByTestId("video-timeline-shell");
  const sidebar = page.getByTestId("video-chapter-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  await sidebar.scrollIntoViewIfNeeded();
  const title = "车辆驶入";
  const chapterRow = sidebar.getByTestId("video-chapter-row").filter({ hasText: title });
  await expect(
    chapterRow,
    "The recording chapter must not collide with a seed chapter",
  ).toHaveCount(0);
  const frame = await currentVideoFrame(page);
  await parkVideoPointer(page);
  const createStartMs = Date.now();
  await page.waitForTimeout(1500);
  const arm = sidebar.getByRole("button", { name: "圈选", exact: true });
  await arm.click();
  await expect(arm).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("video-chapter-draft-hint")).toBeVisible();
  const box = await timeline.boundingBox();
  if (!box) throw new Error("Video timeline is not visible");
  const start = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.55 };
  const end = { x: box.x + box.width * 0.48, y: start.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, start, end, 1100);
  await page.mouse.up();
  const form = page.getByTestId("video-chapter-form");
  await expect(form).toBeVisible();
  const createdBounds = {
    start_frame: Math.round(maxFrame * 0.2),
    end_frame: Math.round(maxFrame * 0.48),
  };
  await expect(form.getByLabel(/^起始帧/)).toHaveValue(String(createdBounds.start_frame));
  await expect(form.getByLabel(/^结束帧/)).toHaveValue(String(createdBounds.end_frame));
  expect(await currentVideoFrame(page), "Chapter brushing must not seek the video").toBe(frame);
  await form.getByPlaceholder("章节标题").pressSequentially(title, { delay: 120 });
  await page.waitForTimeout(800);
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        /\/api\/v1\/videos\/[^/]+\/chapters$/.test(new URL(candidate.url()).pathname),
      { timeout: 10_000 },
    ),
    form.getByRole("button", { name: "创建", exact: true }).click(),
  ]);
  const created = await chapterResponse(response);
  // Register cleanup before checking the remaining response and UI assertions.
  onCreated({ datasetItemId: created.dataset_item_id, chapterId: created.id });
  expect(created.id).toBeTruthy();
  expect(created.dataset_item_id).toBeTruthy();
  expect(new URL(response.url()).pathname).toBe(
    `/api/v1/videos/${created.dataset_item_id}/chapters`,
  );
  expect(response.request().postDataJSON()).toMatchObject({ title, ...createdBounds });
  expect(created).toMatchObject({ title, ...createdBounds, source: "manual" });
  await expect(form).toHaveCount(0);
  await expect(chapterRow).toHaveCount(1);
  // The marker itself owns the title; scope by the exact server-confirmed bounds.
  const chapterMarker = (startFrame: number, endFrame: number) =>
    page
      .getByTestId("video-timeline-chapter")
      .and(page.locator(`[title="${title} · F${startFrame}-F${endFrame}"]`));
  const assertChapterVisible = async (startFrame: number, endFrame: number) => {
    await expect(chapterRow).toContainText(`F${startFrame}–F${endFrame}`);
    await expect(chapterRow).toBeInViewport({ ratio: 1 });
    await expect(chapterMarker(startFrame, endFrame)).toBeVisible();
    expect(
      await chapterRow.locator("b").evaluate((node) => node.scrollWidth - node.clientWidth),
      "The chapter title must remain readable without clipping",
    ).toBeLessThanOrEqual(1);
    await assertVideoTimelineVisible(page);
  };
  await parkVideoPointer(page);
  await assertChapterVisible(created.start_frame, created.end_frame);
  await page.waitForTimeout(1800);
  const createEndMs = Date.now();
  const resizeStartMs = Date.now();
  await chapterRow.hover();
  await expect(chapterMarker(created.start_frame, created.end_frame)).toHaveAttribute(
    "data-hovered",
    "true",
  );
  await page.waitForTimeout(600);
  const chapterPath = `/api/v1/videos/${created.dataset_item_id}/chapters/${created.id}`;
  let current = created;
  const resize = async (edge: "start" | "end", targetFrame: number) => {
    const handle = chapterMarker(current.start_frame, current.end_frame)
      .locator("..")
      .getByTestId(`video-chapter-resize-${edge}`);
    const handleBox = await handle.boundingBox();
    const timelineBox = await timeline.boundingBox();
    if (!handleBox || !timelineBox) throw new Error(`Chapter ${edge} handle is not visible`);
    const from = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    const to = { x: timelineBox.x + (timelineBox.width * targetFrame) / maxFrame, y: from.y };
    const patched = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "PATCH" &&
        new URL(candidate.url()).pathname === chapterPath,
      { timeout: 20_000 },
    );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await movePointerAtRefreshRate(page, from, to, 1100);
    await page.mouse.up();
    const updateResponse = await patched;
    const expected = {
      start_frame: edge === "start" ? targetFrame : current.start_frame,
      end_frame: edge === "end" ? targetFrame : current.end_frame,
    };
    expect(updateResponse.request().postDataJSON()).toMatchObject(expected);
    current = await chapterResponse(updateResponse);
    expect(current).toMatchObject({
      id: created.id,
      dataset_item_id: created.dataset_item_id,
      title,
      ...expected,
    });
    expect(await currentVideoFrame(page), "Chapter resizing must not seek the video").toBe(frame);
    await parkVideoPointer(page);
    await assertChapterVisible(current.start_frame, current.end_frame);
    await page.waitForTimeout(1500);
  };
  await resize("end", Math.round(maxFrame * 0.68));
  await resize("start", Math.round(maxFrame * 0.28));
  await parkVideoPointer(page);
  await page.waitForTimeout(2200);
  await assertChapterVisible(current.start_frame, current.end_frame);
  const resizeEndMs = Date.now();
  await page.reload();
  await expect(page.getByTestId("video-konva-stage")).toBeVisible();
  await page.getByRole("tab", { name: "标注详情", exact: true }).click();
  await expect(chapterRow).toHaveCount(1);
  await expect(chapterRow).toContainText(`F${current.start_frame}–F${current.end_frame}`);
  const stored = await page.evaluate(async (datasetItemId) => {
    const result = await fetch(`/api/v1/videos/${datasetItemId}/chapters`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (!result.ok) throw new Error(`Chapter reload: HTTP ${result.status}`);
    return result.json() as Promise<{ chapters: VideoChapter[] }>;
  }, created.dataset_item_id);
  expect(stored.chapters.find((chapter) => chapter.id === created.id)).toMatchObject({
    title,
    dataset_item_id: created.dataset_item_id,
    start_frame: current.start_frame,
    end_frame: current.end_frame,
  });
  return {
    create: { drawStartMs: createStartMs, drawEndMs: createEndMs },
    resize: { drawStartMs: resizeStartMs, drawEndMs: resizeEndMs },
    evidence: {
      chapterId: created.id,
      datasetItemId: created.dataset_item_id,
      created: createdBounds,
      resized: { start_frame: current.start_frame, end_frame: current.end_frame },
      currentFrame: frame,
      reloadVerified: true,
    },
  };
}
