/**
 * 真实 SAM3 工具录制：四种交互都对齐同一辆完整车辆并停在候选态；首页 Magic Box
 * 实证额外确认类别。使用 image_demo.annotating 的真实道路图与已绑定 sam3-backend，
 * 快捷键 3 先把当前类别切到 car，避免候选确认时出现与画面不一致的默认类别。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  commitPendingAnnotationClass,
  mediaBbox,
  mediaPoint,
  movePointerAtRefreshRate,
  openImageAnnotate,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export type SamRecordingTool = "smart-point" | "smart-box" | "magic-box" | "exemplar";

export async function runSamToolRecording(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  toolId: SamRecordingTool,
  options: { accept?: boolean } = {},
): Promise<DrawWindow> {
  const anchor = catalog.projects.image_demo.tasks.annotating.recording_anchors?.primary_vehicle;
  if (!anchor) {
    throw new Error("[sam-interactive] image_demo.annotating 缺少 primary_vehicle 语义锚点");
  }
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
  if (toolId === "exemplar") {
    // SAM3 exemplar 当前返回框候选；显式让请求几何与 Exemplar 形态都选择框，
    // 避免默认原生 Mask 合同把合法 rectangle candidate 当成无效 Mask。
    await page.getByTestId("single-frame-output-geometry-select").selectOption("polygon");
    await page.getByTestId("exemplar-output-mode-select").selectOption("box");
  }
  await page.keyboard.press("3"); // COCO 快捷类别 car
  await page.waitForTimeout(600);

  const stage = page.getByTestId("workbench-stage");
  const box = await renderedMediaBounds(stage);

  const drawStartMs = Date.now();
  await page.waitForTimeout(1_200); // 稳定展示已选工具、目标和当前 car 类别

  // 锚点由媒体归一化坐标表达；可由模型预选、人工复核后写入 screenshot catalog。
  // 录制阶段只消费已版本化的锚点，避免每次推理漂移导致 GIF 构图不稳定。
  if (toolId === "smart-point") {
    const point = mediaPoint(box, anchor.point);
    // 4K Konva 重绘下 Playwright 的 steps 会把一次移入拖成约 10 秒；单点提示无需
    // 人为放慢鼠标，直接移入后保留短暂停顿即可看清点击位置与因果关系。
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(350);
    await page.mouse.click(point.x, point.y);
  } else {
    const { start, end } = mediaBbox(box, anchor.bbox);
    await page.mouse.move(start.x, start.y);
    await page.waitForTimeout(350);
    await page.mouse.down();
    await movePointerAtRefreshRate(page, start, end, 650);
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
  await page.waitForTimeout(1_500);

  if (options.accept) {
    if (toolId !== "magic-box") await page.keyboard.press("Enter");
    await page.getByTestId("class-picker-popover").waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(800);
    await commitPendingAnnotationClass(page, {
      label: anchor.label,
      taskId: catalog.projects.image_demo.tasks.annotating.id,
    });
    await acceptTitle.waitFor({ state: "hidden", timeout: 15_000 });
    await page.waitForTimeout(toolId === "magic-box" ? 3_200 : 2_000);
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
