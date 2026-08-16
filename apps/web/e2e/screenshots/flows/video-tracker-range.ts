/**
 * 流程录制：打开 AI 追踪面板后 Shift+拖选时间轴，自定义影响范围同步回填。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  mediaPoint,
  movePointerAtRefreshRate,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runVideoTrackerRange(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const timeline = page.getByTestId("video-timeline-shell");
  await timeline.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("video-konva-stage").waitFor({ timeout: 10_000 });
  await page.addStyleTag({
    content: '[data-testid="video-frame-preview-popover"] { display: none !important; }',
  });
  await page.waitForTimeout(800);

  const drawStartMs = Date.now();
  await page.getByTestId("workbench-ai-tracker").click();
  const dialog = page.getByTestId("video-tracker-propagate-dialog");
  await dialog.waitFor({ timeout: 5_000 });
  await page.waitForTimeout(900);

  const modelSelect = dialog.locator("#tracker-model");
  const modelValues = await modelSelect
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const seedModel = ["sam3_video_interactive", "sam2_video"].find((value) =>
    modelValues.includes(value),
  );
  if (!seedModel) throw new Error("[video-tracker-range] 缺少可用的交互式视频模型");
  await modelSelect.selectOption(seedModel);
  const anchor = recordingAnchor(catalog, "video_demo", "tracking", "left_bus_f0", 0);
  await dialog.getByTestId("tracker-target-class").selectOption(anchor.label);
  const stage = page.getByTestId("video-konva-stage");
  const media = await renderedMediaBounds(stage);
  await dialog.getByTestId("tracker-seed-toggle").click();
  const seed = mediaPoint(media, anchor.point);
  await page.mouse.click(seed.x, seed.y);
  await dialog.getByTestId("tracker-seed-target-1").waitFor({ timeout: 3_000 });
  await dialog.getByTestId("tracker-seed-toggle").click();
  await page.waitForTimeout(700);

  const box = await timeline.boundingBox();
  if (!box) throw new Error("[video-tracker-range] 时间轴不可见");
  // 目标种子落在 F0，影响范围必须从 F0 开始；否则 SAM3 的首个解码窗不包含
  // 种子帧，后端会正确拒绝这条无意义的追踪请求。
  const startX = box.x + 2;
  const endX = box.x + box.width * 0.44;
  const y = box.y + box.height * 0.55;
  await page.keyboard.down("Shift");
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, { x: startX, y }, { x: endX, y }, 700, {
    shiftKey: true,
  });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const customRange = page.getByTestId("tracker-range-custom");
  await customRange.waitFor({ timeout: 5_000 });
  const rangeText = await customRange.locator("..").textContent();
  if (!rangeText?.includes("F0 →")) {
    throw new Error(`[video-tracker-range] 自定义范围必须包含 F0 种子，实际为 ${rangeText}`);
  }
  await page.waitForTimeout(1400);

  await dialog.getByRole("button", { name: "开始发现" }).click();
  const review = page.getByTestId("video-tracker-review-bar");
  await review.waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(1_800);
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/decisions") &&
      response.ok(),
    { timeout: 20_000 },
  );
  await review.getByTestId("tracker-review-accept").click();
  await accepted;
  await page.waitForTimeout(2_000);
  return { drawStartMs, drawEndMs: Date.now() };
}
