/**
 * 流程录制：在时间轴上圈选章节，再用章节条拖柄调整范围。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export interface VideoChapterRecordingWindows {
  create: DrawWindow;
  resize: DrawWindow;
}

export async function runVideoChapter(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<VideoChapterRecordingWindows> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);

  const timeline = page.getByTestId("video-timeline-shell");
  const sidebar = page.getByTestId("video-chapter-sidebar");
  await timeline.waitFor({ state: "visible", timeout: 15_000 });
  await sidebar.waitFor({ state: "visible", timeout: 10_000 });
  await page.addStyleTag({
    content: '[data-testid="video-frame-preview-popover"] { display: none !important; }',
  });
  await page.waitForTimeout(700);

  const createStartMs = Date.now();
  await page.waitForTimeout(1_500);
  await sidebar.getByRole("button", { name: "圈选" }).click();
  await page.getByTestId("video-chapter-draft-hint").waitFor({ timeout: 3_000 });

  const timelineBox = await timeline.boundingBox();
  if (!timelineBox) throw new Error("[video-chapter] 时间轴不可见");
  const startX = timelineBox.x + timelineBox.width * 0.2;
  const endX = timelineBox.x + timelineBox.width * 0.48;
  const y = timelineBox.y + timelineBox.height * 0.55;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, { x: startX, y }, { x: endX, y }, 700);
  await page.mouse.up();

  const form = page.getByTestId("video-chapter-form");
  await form.waitFor({ timeout: 3_000 });
  await form.getByPlaceholder("章节标题").pressSequentially("车辆驶入", { delay: 120 });
  await page.waitForTimeout(600);
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/chapters"),
      { timeout: 5_000 },
    ),
    form.getByRole("button", { name: "创建" }).click(),
  ]);
  const chapterRow = page.getByTestId("video-chapter-row").filter({ hasText: "车辆驶入" });
  await chapterRow.waitFor({ timeout: 5_000 });
  await page.getByTestId("video-timeline-chapter").waitFor({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
  const createEndMs = Date.now();

  const resizeStartMs = Date.now();
  await page.getByTestId("video-timeline-toggle").click();
  await page.getByTestId("video-timeline-lane-chapters").waitFor({ timeout: 3_000 });
  await page.waitForTimeout(900);

  const chapter = page.getByTestId("video-timeline-chapter").first();
  await chapterRow.hover();
  await chapter.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="video-timeline-chapter"]')
        ?.getAttribute("data-hovered") === "true",
    undefined,
    { timeout: 3_000 },
  );
  await page.waitForTimeout(500);

  const endHandle = page.getByTestId("video-chapter-resize-end").first();
  const handleBox = await endHandle.boundingBox();
  if (!handleBox) throw new Error("[video-chapter] 章节结束拖柄不可见");
  const handleX = handleBox.x + handleBox.width / 2;
  const handleY = handleBox.y + handleBox.height / 2;
  const patched = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/chapters/"),
    { timeout: 20_000 },
  );
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await movePointerAtRefreshRate(
    page,
    { x: handleX, y: handleY },
    { x: handleX + Math.min(140, timelineBox.width * 0.12), y: handleY },
    700,
  );
  await page.mouse.up();
  await patched;
  await page.waitForTimeout(1_000);

  // 继续调整起点，完整表达“修改章节起止范围”，而不只是拉长结尾。
  const startHandle = page.getByTestId("video-chapter-resize-start").first();
  const startHandleBox = await startHandle.boundingBox();
  if (!startHandleBox) throw new Error("[video-chapter] 章节起始拖柄不可见");
  const startHandleX = startHandleBox.x + startHandleBox.width / 2;
  const startHandleY = startHandleBox.y + startHandleBox.height / 2;
  const startPatched = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/chapters/"),
    { timeout: 20_000 },
  );
  await page.mouse.move(startHandleX, startHandleY);
  await page.mouse.down();
  await movePointerAtRefreshRate(
    page,
    { x: startHandleX, y: startHandleY },
    { x: startHandleX + Math.min(90, timelineBox.width * 0.08), y: startHandleY },
    700,
  );
  await page.mouse.up();
  await startPatched;
  await page.waitForTimeout(1_600);

  return {
    create: { drawStartMs: createStartMs, drawEndMs: createEndMs },
    resize: { drawStartMs: resizeStartMs, drawEndMs: Date.now() },
  };
}
