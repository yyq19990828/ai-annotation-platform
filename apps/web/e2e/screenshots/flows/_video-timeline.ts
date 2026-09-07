import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";

export async function currentVideoFrame(page: Page): Promise<number> {
  const value = await page.getByTestId("video-konva-stage").getAttribute("data-video-frame-index");
  if (value === null || !/^\d+$/.test(value)) throw new Error(`Invalid video frame: ${value}`);
  return Number(value);
}

export async function assertVideoTimelineVisible(page: Page): Promise<void> {
  const stage = page.getByTestId("video-konva-stage");
  const timeline = page.getByTestId("video-timeline-shell");
  await expect(stage).toBeInViewport({ ratio: 1 });
  await expect(timeline).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("video-playback-overlay")).toHaveAttribute(
    "data-state",
    "expanded",
  );
  const bounds = await stage.boundingBox();
  expect(bounds?.height, "The video must remain readable above the timeline").toBeGreaterThan(200);
}

export async function parkVideoPointer(page: Page): Promise<void> {
  const bounds = await page.getByTestId("video-konva-stage").boundingBox();
  if (!bounds) throw new Error("Video stage is not visible");
  // Stay inside the video to keep its playback controls visible, away from preview targets.
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + 24);
}

export async function openVideoTimeline(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<number> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const stage = page.getByTestId("video-konva-stage");
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await parkVideoPointer(page);
  await expect(page.getByTestId("video-timeline-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("video-konva-source")).toHaveJSProperty("paused", true);
  await expect
    .poll(() =>
      page
        .getByTestId("video-konva-source")
        .evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("tab", { name: "标注详情", exact: true }).click();
  await page.getByTestId("video-tool-btn-select").click();
  await parkVideoPointer(page);
  const toggle = page.getByTestId("video-timeline-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByRole("button", { name: "回到首帧", exact: true }).click();
  await expect.poll(() => currentVideoFrame(page)).toBe(0);
  const reset = page.getByRole("button", { name: "适配全部帧", exact: true });
  if (await reset.isEnabled()) await reset.click();
  await parkVideoPointer(page);
  await assertVideoTimelineVisible(page);
  const readout = await page.getByTestId("video-timeline-window-readout").innerText();
  const match = /全部\s*·\s*F0–F?(\d+)/.exec(readout);
  if (!match) throw new Error(`Expected full video window, received: ${readout}`);
  const maxFrame = Number(match[1]);
  expect(maxFrame).toBeGreaterThan(48);
  return maxFrame;
}

export async function readVideoWindow(
  page: Page,
  maxFrame: number,
): Promise<{ from: number; to: number }> {
  const { left, width } = await page
    .getByTestId("video-timeline-navigator-window")
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        left: parseFloat(style.getPropertyValue("--timeline-left")),
        width: parseFloat(style.getPropertyValue("--timeline-width")),
      };
    });
  expect(Number.isFinite(left) && Number.isFinite(width)).toBe(true);
  return { from: (left * maxFrame) / 100, to: ((left + width) * maxFrame) / 100 };
}
