import { recordingPanelCommand } from "./_workbench-layout";
/**
 * 流程录制：AI 追踪面板——顶部打开、Dockview 换位、隐藏恢复与 AI 单题成组。
 *
 * 本 flow 不发起 tracker job，不修改标注数据；账号级偏好写入由录制沙箱隔离。
 */
import { expect, type Page } from "@playwright/test";
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
  const range = tracker.getByRole("combobox", { name: "帧范围", exact: true });
  const direction = tracker.getByTestId("tracker-direction-bidirectional");
  const expectTrackerState = async () => {
    await expect(tracker).toHaveCount(1);
    await expect(page.locator('[data-workbench-panel="video-tracker"]')).toHaveCount(1);
    await expect(tracker).toBeVisible();
    await expect(range).toHaveValue("60");
    await expect(direction).toHaveAttribute("aria-pressed", "true");
  };
  const drawStartMs = Date.now();
  await page.waitForTimeout(1000);

  await trackerButton.click();
  await tracker.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(1000);
  await direction.click();
  await page.waitForTimeout(400);
  await range.selectOption("60");
  await expectTrackerState();
  await page.waitForTimeout(1400);

  await recordingPanelCommand(page, "视频追踪", "浮动面板");
  await expectTrackerState();
  await page.waitForTimeout(1600);
  await recordingPanelCommand(page, "视频追踪", "停靠到右侧");
  await expectTrackerState();
  await page.waitForTimeout(1600);

  await recordingPanelCommand(page, "视频追踪", "隐藏面板");
  await tracker.waitFor({ state: "hidden", timeout: 3000 });
  await expect(tracker).toHaveCount(1);
  await page.waitForTimeout(700);
  await trackerButton.click();
  await expectTrackerState();
  await page.waitForTimeout(1700);

  await singleButton.click();
  await single.waitFor({ state: "visible", timeout: 3000 });
  await expect(single).toHaveCount(1);
  await expect(page.locator('[data-workbench-panel="ai-task"]')).toHaveCount(1);
  await expectTrackerState();
  await page.waitForTimeout(2200);

  await recordingPanelCommand(page, "当前题 AI", "与视频追踪合并为标签");
  const trackerTab = page.getByRole("tab").filter({
    has: page.getByRole("button", { name: "隐藏视频追踪", exact: true }),
  });
  const singleTab = page.getByRole("tab").filter({
    has: page.getByRole("button", { name: "隐藏当前题 AI", exact: true }),
  });
  await expect(trackerTab).toHaveCount(1);
  await expect(singleTab).toHaveCount(1);
  await expect(single).toBeVisible();
  await page.waitForTimeout(1700);
  await trackerTab.click();
  await expectTrackerState();
  await expect(single).toBeHidden();
  await expect(single).toHaveCount(1);
  await page.waitForTimeout(1800);
  await singleTab.click();
  await expect(single).toBeVisible();
  await expect(tracker).toBeHidden();
  await page.waitForTimeout(1500);
  await trackerTab.click();
  await expectTrackerState();
  await expect(single).toBeHidden();
  await page.waitForTimeout(2000);

  return { drawStartMs, drawEndMs: Date.now() };
}
