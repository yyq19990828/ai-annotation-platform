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
 * 盲坐标:视频用 Konva 叠加层, 画框落点取 video-konva-stage 的 boundingBox 再按比例算客户端坐标
 * (finishDrag 内部 clientPointToVideoPoint 会把客户端坐标转成归一化 [0,1])。
 *
 * 返回 { drawStartMs, drawEndMs }:供 finalize 裁掉开头(导航/解析/就绪等待)。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

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
  const box = await surface.boundingBox();
  if (!box) throw new Error("[video-draw] video-konva-stage 没有可见边界");
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  const drawStartMs = Date.now();

  // ── 第 0 帧:画第一个框(新建 track, 关键帧 @0)──
  const a0 = at(0.34, 0.42);
  const a1 = at(0.5, 0.66);
  await page.mouse.move(a0.x, a0.y);
  await page.mouse.down();
  await page.mouse.move((a0.x + a1.x) / 2, (a0.y + a1.y) / 2, { steps: 6 });
  await page.mouse.move(a1.x, a1.y, { steps: 6 });
  await page.mouse.up();
  // 画完弹 ClassPickerPopover, Enter 用默认类别提交(否则停在 pending draft 不落库)。
  await page.getByTestId("class-picker-popover").waitFor({ timeout: 3000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);

  // ── 前进 8 帧:此间该 track 暂无第二关键帧, 框停留(展示帧推进)──
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(500);

  // ── 第 8 帧:再画一个框(track 已选中, upsert 关键帧 @8, 位置右移演示运动)──
  const b0 = at(0.5, 0.36);
  const b1 = at(0.66, 0.6);
  await page.mouse.move(b0.x, b0.y);
  await page.mouse.down();
  await page.mouse.move((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, { steps: 6 });
  await page.mouse.move(b1.x, b1.y, { steps: 6 });
  await page.mouse.up();
  // track 工具已选中该 track 时, 第二次画框是 upsert 关键帧, 通常不再弹 popover;
  // 若弹(被当作新 pending)仍 Enter 兜底提交。
  if (await page.getByTestId("class-picker-popover").count()) {
    await page.getByTestId("class-picker-popover").waitFor({ timeout: 1500 });
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);

  // ── 回到第 0 帧再逐帧前进:展示两关键帧间 bbox 线性插值平滑移动 ──
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(260);
  }
  await page.waitForTimeout(900);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
