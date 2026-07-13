/**
 * 首页 AI 实证流程：Magic Box 粗框 → SAM3 候选 → 人工确认类别。
 *
 * 使用 image_demo.annotating 的真实道路图与已绑定 sam3-backend。Magic Box 复用
 * interactive_box prompt，并把分割候选收紧为训练可用的 bbox；快捷键 3 先把当前
 * 类别切到 car，避免候选确认时出现与画面不一致的默认类别。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { openImageAnnotate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runSamInteractive(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  // fresh repair 会异步回填媒体；stage 外壳先出现，Konva 背景层稍后才真正绘出图像。
  // 等画布中心像素有内容再派发 prompt，避免在 checkerboard 占位期拖框被静默忽略。
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="workbench-stage"] canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    try {
      const data = canvas.getContext("2d")?.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      ).data;
      return !!data && data[3] > 0;
    } catch {
      return false;
    }
  }, undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);

  const tool = page.getByTestId("tool-btn-magic-box");
  await tool.waitFor({ state: "visible" });
  if (!(await tool.isEnabled())) {
    throw new Error("[sam-interactive] Magic Box 被禁用，检查 image_demo 的 SAM3 能力绑定");
  }
  await tool.click();
  await page.getByTestId("interactive-toolbar").waitFor({ state: "visible" });
  await page.keyboard.press("3"); // COCO 快捷类别 car
  await page.waitForTimeout(600);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("[sam-interactive] workbench-stage 没有可见边界");

  // screenshot_03.jpg 右侧银色轿车。主体四周留出少量 prompt 边界，且不包含相邻车辆。
  // 比例相对 stage 固定，避免依赖具体 UUID 或绝对坐标。
  const start = { x: box.x + box.width * 0.67, y: box.y + box.height * 0.37 };
  const end = { x: box.x + box.width * 0.82, y: box.y + box.height * 0.53 };
  const drawStartMs = Date.now();

  await page.mouse.move(start.x, start.y, { steps: 8 });
  await page.waitForTimeout(350);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * i) / 12,
      start.y + ((end.y - start.y) * i) / 12,
    );
    await page.waitForTimeout(45);
  }
  await page.mouse.up();

  const acceptTitle = page.getByText("接受 SAM 候选 → 选类别", { exact: true });
  await acceptTitle.waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(1200);

  // 默认类别已切为 car；Enter 是产品内明确展示的确认路径。
  await page.keyboard.press("Enter");
  await acceptTitle.waitFor({ state: "hidden", timeout: 15_000 });
  await page.waitForTimeout(1400);

  return { drawStartMs, drawEndMs: Date.now() };
}
