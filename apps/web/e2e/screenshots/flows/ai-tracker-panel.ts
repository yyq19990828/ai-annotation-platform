/**
 * 流程录制：AI 追踪面板——顶部打开、Dockview 换位、隐藏恢复与 AI 单题成组。
 *
 * 本 flow 不发起 tracker job，不修改标注数据；账号级偏好写入由录制沙箱隔离。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runAiTrackerPanel(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.evaluate(() => {
    localStorage.removeItem("wb:video-tracker-panel-position");
    localStorage.removeItem("wb:video-tracker-panel-size");
  });
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15_000 });
  await page.getByTestId("video-konva-stage").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const trackerButton = page.getByTestId("workbench-ai-tracker");
  const singleButton = page.getByTestId("workbench-ai-single");
  const tracker = page.getByTestId("video-tracker-propagate-dialog");
  const single = page.getByTestId("ai-prediction-popover");
  const drawStartMs = Date.now();

  await trackerButton.click();
  await tracker.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(900);

  await page.getByRole("button", { name: "视频追踪菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "浮动面板", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "视频追踪菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "停靠到右侧", exact: true }).click();
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "视频追踪菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "隐藏面板", exact: true }).click();
  await tracker.waitFor({ state: "hidden", timeout: 3000 });
  await page.waitForTimeout(350);
  await trackerButton.click();
  await tracker.waitFor({ state: "visible", timeout: 3000 });
  await page.waitForTimeout(800);

  await singleButton.click();
  await single.waitFor({ state: "visible", timeout: 3000 });
  await tracker.waitFor({ state: "visible", timeout: 3000 });
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "当前题 AI菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "与视频追踪合并为标签", exact: true }).click();
  await page.waitForTimeout(500);
  await trackerButton.click();
  await tracker.waitFor({ state: "visible", timeout: 3000 });
  await single.waitFor({ state: "hidden", timeout: 3000 });
  await page.waitForTimeout(900);

  return { drawStartMs, drawEndMs: Date.now() };
}
