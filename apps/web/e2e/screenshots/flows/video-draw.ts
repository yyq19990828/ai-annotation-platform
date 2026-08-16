/**
 * 流程录制：视频时序工作台画框追踪(video-draw) —— track 工具画 2 个关键帧, 中间帧线性插值。
 *
 * 输出：outputs/flows/video-draw.gif → docs-site/.../workbench/video-track-trajectory.gif
 *
 * 数据来自 screenshot catalog 的 video_demo（固定公开行车视频）。演示"轨迹"概念:
 * 选 track 工具 → 第 0 帧画框(新建 track, 关键帧0)→ 前进若干帧 → 再画框(自动 upsert 关键帧)
 * → 两关键帧间逐帧前进时 bbox 线性插值平滑移动。
 *
 * 落库:geometry.type=video_track_bbox(或单帧 video_bbox)，由 flows.spec afterAll 重建截图 seed 清理。
 *
 * 两个关键帧使用 screenshot catalog 内经复核的同一车辆时序锚点；录制时再把媒体归一化
 * 坐标映射为 video-konva-stage 客户端坐标。
 *
 * 返回 { drawStartMs, drawEndMs }:供 finalize 裁掉开头(导航/解析/就绪等待)。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  mediaBbox,
  movePointerAtRefreshRate,
  recordingAnchor,
  renderedMediaBounds,
  selectVideoRecordingClass,
  commitPendingAnnotationClass,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

async function seekFrameWithTimeline(page: Page, frameIndex: number): Promise<void> {
  const readout = await page.getByTestId("video-timeline-window-readout").first().textContent();
  const maxFrame = Number(readout?.match(/F0–(\d+)/)?.[1]);
  if (!Number.isInteger(maxFrame) || maxFrame <= 0 || frameIndex > maxFrame) {
    throw new Error(`[video-draw] 无法从时间轴读取有效帧范围: ${readout ?? ""}`);
  }
  const slider = page.getByRole("slider", { name: "视频帧时间轴" }).first();
  await slider.fill(String(Math.round((frameIndex / maxFrame) * 10_000)));
  await expect(page.getByTestId("video-konva-stage")).toHaveAttribute(
    "data-video-frame-index",
    String(frameIndex),
    { timeout: 10_000 },
  );
}

export async function runVideoDraw(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  await page.waitForLoadState("domcontentloaded");

  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2500);

  // 选 track(跨帧轨迹)工具:画框会建/扩展 track 关键帧并自动插值。
  const trackBtn = page.getByTestId("video-tool-btn-track");
  await trackBtn.click();
  await page.waitForTimeout(500);

  // 取视频画布区域, 用其 boundingBox 算落点(客户端像素), finishDrag 内部转归一化。
  const surface = page.getByTestId("video-konva-stage");
  const box = await renderedMediaBounds(surface);
  const firstAnchor = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f0", 0);
  const secondAnchor = recordingAnchor(catalog, "video_demo", "tracking", "front_truck_f8", 8);

  const drawStartMs = Date.now();

  // ── 第 0 帧:画第一个框(新建 track, 关键帧 @0)──
  await selectVideoRecordingClass(page, surface, firstAnchor.label);
  const first = mediaBbox(box, firstAnchor.bbox);
  await page.mouse.move(first.start.x, first.start.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, first.start, first.end, 700);
  await page.mouse.up();
  await commitPendingAnnotationClass(page, {
    label: firstAnchor.label,
    taskId: project.tasks.tracking.id,
  });
  await page.waitForTimeout(1000);

  // ── 直接定位 F8 建立第二关键帧，避免为准备阶段重复渲染 8 个中间帧 ──
  await seekFrameWithTimeline(page, 8);
  await page.waitForTimeout(700);

  // ── 第 8 帧:再画一个框(track 已选中, upsert 关键帧 @8, 位置右移演示运动)──
  const second = mediaBbox(box, secondAnchor.bbox);
  const secondKeyframeSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/annotations/") &&
      response.ok(),
    { timeout: 20_000 },
  );
  // F8 与 F0 的真实货车框高度重叠；若从左上角起笔，会先命中 F0 的参考虚影并进入
  // “移动已有框”，而不是“画框延展轨迹”。从 F8 略超出虚影的右下角反向拖拽，
  // 最终几何完全相同，但产品会走预期的 draw → upsert F8 关键帧链路。
  await page.mouse.move(second.end.x, second.end.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, second.end, second.start, 700);
  await page.mouse.up();
  // track 工具已选中该轨迹，第二次画框直接 upsert F8 关键帧，不再走类别选择。
  await secondKeyframeSaved;
  await page.waitForTimeout(900);

  // ── 回到 F0，再逐帧前进一遍，完整展示线性插值移动 ──
  await seekFrameWithTimeline(page, 0);
  await page.waitForTimeout(600);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(260);
  }
  // 回看中间帧再返回末关键帧，明确展示插值框能双向、逐帧连续检查。
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(260);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(260);
  }
  await page.waitForTimeout(900);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
