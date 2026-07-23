/**
 * 真实 SAM3 工具录制：四种交互都对齐同一辆完整车辆并停在候选态；首页 Magic Box
 * 实证额外确认类别。使用 image_demo.annotating 的真实道路图与已绑定 sam3-backend，
 * 快捷键 3 先把当前类别切到 car，避免候选确认时出现与画面不一致的默认类别。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { openImageAnnotate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export type SamRecordingTool = "smart-point" | "smart-box" | "magic-box" | "exemplar";

export async function runSamToolRecording(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  toolId: SamRecordingTool,
  options: { accept?: boolean } = {},
): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  // fresh repair 会异步回填媒体；stage 外壳先出现，Konva 背景层稍后才真正绘出图像。
  // 等画布中心像素有内容再派发 prompt，避免在 checkerboard 占位期拖框被静默忽略。
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('[data-testid="workbench-stage"] canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      try {
        const data = canvas
          .getContext("2d")
          ?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        return !!data && data[3] > 0;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);

  const tool = page.getByTestId(`tool-btn-${toolId}`);
  await tool.waitFor({ state: "visible" });
  if (!(await tool.isEnabled())) {
    throw new Error(`[sam-interactive] ${toolId} 被禁用，检查 image_demo 的 SAM3 能力绑定`);
  }
  await tool.click();
  await page.getByTestId("interactive-toolbar").waitFor({ state: "visible" });
  await page.keyboard.press("3"); // COCO 快捷类别 car
  await page.waitForTimeout(600);

  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("[sam-interactive] workbench-stage 没有可见边界");

  const drawStartMs = Date.now();

  // screenshot_03.jpg 中下方完整可见的白色 SUV。点提示落在车身中心；三种框提示
  // 从车顶到车尾完整包住车身，且不包含左右车道的相邻车辆。
  // 比例相对 stage 固定，避免依赖具体 UUID 或绝对坐标。
  if (toolId === "smart-point") {
    const point = { x: box.x + box.width * 0.49, y: box.y + box.height * 0.62 };
    await page.mouse.move(point.x, point.y, { steps: 10 });
    await page.waitForTimeout(350);
    await page.mouse.click(point.x, point.y);
  } else {
    const start = { x: box.x + box.width * 0.42, y: box.y + box.height * 0.48 };
    const end = { x: box.x + box.width * 0.56, y: box.y + box.height * 0.75 };
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
  }

  const acceptTitle = page.getByText("接受 SAM 候选 → 选类别", { exact: true });
  if (toolId === "magic-box") {
    await acceptTitle.waitFor({ state: "visible", timeout: 120_000 });
  } else {
    // 智能点 / 智能框 / Exemplar 先进入可 Tab 切换的候选层；类选择器要按 Enter 后才出现。
    // 单候选的桌宠文案省略数字，多候选才显示计数；两种状态都表示推理结果已落到前端。
    await page.getByText(/^(?:候选待处理|[1-9]\d*\s*个候选待处理)$/).waitFor({
      state: "visible",
      timeout: 120_000,
    });
  }
  await page.waitForTimeout(1200);

  if (options.accept) {
    // 默认类别已切为 car；Enter 是产品内明确展示的确认路径。
    await page.keyboard.press("Enter");
    await acceptTitle.waitFor({ state: "hidden", timeout: 15_000 });
    await page.waitForTimeout(1400);
  } else {
    // 文档工具示例停在真实候选态，不落标注；page 关闭后候选自然消失。
    await page.waitForTimeout(1200);
  }

  return { drawStartMs, drawEndMs: Date.now() };
}

export async function runSamInteractive(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  return runSamToolRecording(page, catalog, "magic-box", { accept: true });
}
