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

/**
 * 收起工作台左右边栏（任务列表 / 标注详情），让录制聚焦视频画面。
 * 两个切换钮在 Topbar，展开时 title 为「收起任务列表」/「收起标注详情」（收起后变「展开…」），
 * 按 title 点击只在仍展开时命中，幂等。收起后 stage 容器变宽，等一拍让 video stage 重新适应。
 */
async function collapseSidebars(page: Page): Promise<void> {
  for (const title of ["收起任务列表", "收起标注详情"]) {
    const btn = page.getByTitle(title);
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(400);
}

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

  // 收起左右边栏，画面聚焦视频本身（边栏默认展开，点 Topbar 切换钮收起；收起后 stage 会重新适应窗口）。
  await collapseSidebars(page);

  // 选 select(查看)工具：保证后续点击/按键不会误触发画框。
  const selectBtn = page.getByTestId("video-tool-btn-select");
  await selectBtn.click();
  await page.waitForTimeout(500);

  const drawStartMs = Date.now();

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

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
