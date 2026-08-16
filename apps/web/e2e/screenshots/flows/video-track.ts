/**
 * 流程录制：视频时序追踪工作台(video-track)概览 —— 逐帧前进 + 播放。
 *
 * 输出：outputs/flows/video-track.gif → docs-site/.../workbench/video-track-overview.gif
 *
 * 数据来自 screenshot catalog 的 video_demo（固定公开行车视频，H.264，72 帧）。
 * 本 flow 不落任何标注（纯浏览：选 select 工具避免误画 → ArrowRight 逐帧 → Space 播放），
 * 故无需 afterAll 清理。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(导航/解析/就绪等待)。
 */
import type { Page } from "@playwright/test";
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
  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2200);

  // 选 select(查看)工具：保证后续点击/按键不会误触发画框。
  const selectBtn = page.getByTestId("video-tool-btn-select");
  await selectBtn.click();
  await page.waitForTimeout(500);

  const drawStartMs = Date.now();
  await page.waitForTimeout(1_200);

  // ── 逐帧前进 8 帧（展示帧级控制，画面里车辆逐帧移动）──
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);

  // ── 播放约 3.5s（展示时间轴播放头推进 + 真实运动）──
  await page.keyboard.press("Space");
  await page.waitForTimeout(3500);
  await page.keyboard.press("Space"); // 暂停
  await page.waitForTimeout(700);

  // 暂停后逐帧回看，展示播放头、帧号和画面可以双向核对。
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(240);
  }
  await page.waitForTimeout(900);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
