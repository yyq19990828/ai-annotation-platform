/**
 * 流程录制：视频时序追踪工作台(video-track)概览 —— 逐帧前进 + 播放。
 *
 * 输出：outputs/flows/video-track.gif → docs-site/.../workbench/video-track-overview.gif
 *
 * 数据来自 screenshot catalog 的 video_demo（固定公开行车视频，H.264，72 帧）。
 * 本 flow 不落任何标注（选择已有轨迹 → 双向逐帧 → 播放暂停），
 * 故无需 afterAll 清理。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(导航/解析/就绪等待)。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runVideoTrack(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  await page.waitForLoadState("domcontentloaded");

  // 等时间轴就绪（manifest 加载完成的信号）+ 首帧画面解码。
  const timeline = page.getByTestId("video-timeline-shell");
  const stage = page.getByTestId("video-konva-stage");
  const source = page.getByTestId("video-konva-source");
  await expect(timeline).toBeVisible({ timeout: 15_000 });
  await expect(stage).toBeVisible();
  await expect
    .poll(() => source.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);

  // 选 select(查看)工具：保证后续点击/按键不会误触发画框。
  const selectBtn = page.getByTestId("video-tool-btn-select");
  await selectBtn.click();
  await page.getByRole("button", { name: "展开时间轴详情", exact: true }).click();
  await expect(page.getByTestId("video-playback-overlay")).toHaveAttribute(
    "data-state",
    "expanded",
  );
  const slider = timeline.getByRole("slider", { name: "视频帧时间轴", exact: true });
  await expect(slider).toHaveCount(1);
  const currentFrame = async () => {
    const value = await stage.getAttribute("data-video-frame-index");
    if (value === null || !/^\d+$/.test(value)) {
      throw new Error(`[video-track] 当前视频帧无效: ${value}`);
    }
    return Number(value);
  };

  // Reuse an existing seed track when present; never create data for an overview.
  const tracks = page.getByTestId("video-track-row");
  if ((await tracks.count()) > 0) {
    await tracks.first().click();
    await expect(tracks.first()).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("video-track-timeline")).toBeVisible();
  }
  await page.getByRole("button", { name: "回到首帧", exact: true }).click();
  await expect.poll(currentFrame).toBe(0);
  await expect.poll(() => source.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);

  const drawStartMs = Date.now();
  await page.waitForTimeout(2_000);
  const startTimelineValue = Number(await slider.inputValue());
  const startTimeText = await page.getByTestId("video-time-readout").textContent();

  // ── 逐帧前进 8 帧（展示帧级控制，画面里车辆逐帧移动）──
  for (let i = 0; i < 8; i++) {
    const before = await currentFrame();
    await page.getByRole("button", { name: "下一帧", exact: true }).click();
    await expect.poll(currentFrame).toBeGreaterThan(before);
    await page.waitForTimeout(350);
  }
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(startTimelineValue);
  await expect(page.getByTestId("video-time-readout")).not.toHaveText(startTimeText ?? "");
  await page.waitForTimeout(1200);

  for (let i = 0; i < 3; i++) {
    const before = await currentFrame();
    await page.getByRole("button", { name: "上一帧", exact: true }).click();
    await expect.poll(currentFrame).toBeLessThan(before);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1000);

  // Check the real media element and frame progression, not only the button icon.
  const playToggle = page.getByRole("button", { name: "播放 / 暂停", exact: true });
  const beforePlayback = await currentFrame();
  await playToggle.click();
  await expect.poll(() => source.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await expect.poll(currentFrame).toBeGreaterThan(beforePlayback);
  await page.waitForTimeout(1200);
  await playToggle.click();
  await expect.poll(() => source.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await page.waitForTimeout(250);
  const pausedFrame = await currentFrame();
  await page.waitForTimeout(1500);
  expect(await currentFrame()).toBe(pausedFrame);

  // 暂停后逐帧回看，展示播放头、帧号和画面可以双向核对。
  for (let i = 0; i < 6; i++) {
    const before = await currentFrame();
    await page.getByRole("button", { name: "上一帧", exact: true }).click();
    await expect.poll(currentFrame).toBeLessThan(before);
    await page.waitForTimeout(350);
  }
  await expect(source).toHaveJSProperty("paused", true);
  await expect(timeline).toBeVisible();
  await page.waitForTimeout(3000);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
