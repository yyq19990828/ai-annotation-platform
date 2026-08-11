/**
 * 流程录制：无源视频追踪中为多个目标跨帧添加点/框种子。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { DrawWindow } from "./rotated-bbox";

export async function runVideoMultiTargetSeeds(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  const project = catalog.projects.video_demo;
  await page.evaluate(() => {
    localStorage.removeItem("wb:video-tracker-panel-position");
    localStorage.removeItem("wb:video-tracker-panel-size");
  });
  await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`);
  const stage = page.getByTestId("video-konva-stage");
  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15_000 });
  await stage.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(700);

  const drawStartMs = Date.now();
  await page.getByTestId("workbench-ai-tracker").click();
  const dialog = page.getByTestId("video-tracker-propagate-dialog");
  await dialog.waitFor({ timeout: 5_000 });

  const modelSelect = dialog.locator("#tracker-model");
  const modelValues = await modelSelect
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const seedModel = ["sam3_video_interactive", "sam2_video"].find((value) =>
    modelValues.includes(value),
  );
  if (!seedModel) throw new Error("[video-multi-target-seeds] 截图后端没有可用的交互式视频模型");
  await modelSelect.selectOption(seedModel);

  const toggle = page.getByTestId("tracker-seed-toggle");
  await toggle.waitFor({ timeout: 3_000 });
  await toggle.click();
  await page.waitForTimeout(350);

  const box = await stage.boundingBox();
  if (!box) throw new Error("[video-multi-target-seeds] 视频画布不可见");
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  const target1 = at(0.3, 0.48);
  await page.mouse.click(target1.x, target1.y);
  await page.getByTestId("tracker-seed-target-1").waitFor({ timeout: 3_000 });
  await page.waitForTimeout(450);

  await page.getByTestId("tracker-seed-new-target").click();
  const target2 = at(0.62, 0.48);
  await page.mouse.click(target2.x, target2.y);
  await page.getByTestId("tracker-seed-target-2").waitFor({ timeout: 3_000 });
  await page.waitForTimeout(550);

  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(170);
  }
  const negative = at(0.67, 0.43);
  await page.keyboard.down("Alt");
  await page.mouse.click(negative.x, negative.y);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(550);

  await page.getByTestId("tracker-seed-mode-box").click();
  const boxStart = at(0.54, 0.34);
  const boxEnd = at(0.71, 0.62);
  await page.mouse.move(boxStart.x, boxStart.y);
  await page.mouse.down();
  await page.mouse.move(boxEnd.x, boxEnd.y, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(650);

  await toggle.click();
  await page.getByTestId("tracker-seed-target-2").filter({ hasText: "F4" }).waitFor({
    timeout: 3_000,
  });
  await page.waitForTimeout(1_000);
  return { drawStartMs, drawEndMs: Date.now() };
}
