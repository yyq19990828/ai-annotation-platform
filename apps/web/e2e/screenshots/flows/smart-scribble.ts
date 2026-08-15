/**
 * 流程录制：选中已存原生 Mask，用正、负智能笔迹连续精修并停在候选态。
 *
 * Mask、权限与签名候选来自隔离截图数据库；只用 page.route 固定推理响应，
 * 避免文档录制依赖 GPU，同时保留真实工作台手势、候选渲染和会话状态。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog, SeedNativeMaskCandidateData } from "../../fixtures/seed";
import {
  commitPendingAnnotationClass,
  mediaPoint,
  movePointerAtRefreshRate,
  openImageAnnotate,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

const SMART_SCRIBBLE_SETUP = {
  name: "screenshot-smart-scribble",
  version: "1.0.0",
  model_version: "screenshot-smart-scribble",
  is_interactive: true,
  supported_prompts: ["point", "interactive_box", "exemplar", "mask", "scribble"],
  supported_inputs: ["full_image", "point_prompt", "bbox_prompt", "mask_prompt", "scribble_prompt"],
  supported_geometric_outputs: ["polygon", "mask"],
  models: [
    {
      id: "e2e-native-mask",
      display_name: "Smart Scribble",
      task: "interactive_seg",
      model_family: "screenshot-fixture",
      composition: "atom",
      is_interactive: true,
      supported_prompts: ["point", "interactive_box", "exemplar", "mask", "scribble"],
      supported_inputs: [
        "full_image",
        "point_prompt",
        "bbox_prompt",
        "mask_prompt",
        "scribble_prompt",
      ],
      supported_geometric_outputs: ["polygon", "mask"],
      resource_profile: { device: "cpu", batchable: false },
    },
  ],
};

export async function runSmartScribble(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  sourceAnnotationId: string,
  fixture: SeedNativeMaskCandidateData,
): Promise<DrawWindow> {
  const promptContexts: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/v1\/projects\/[^/]+\/ml-backends\/[^/]+\/setup/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SMART_SCRIBBLE_SETUP),
    }),
  );
  await page.route(
    /\/api\/v1\/projects\/[^/]+\/ml-backends\/[^/]+\/interactive-annotating$/,
    async (route) => {
      const body = route.request().postDataJSON() as { context?: Record<string, unknown> };
      promptContexts.push(body.context ?? {});
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixture.response),
      });
    },
  );

  await openImageAnnotate(page, catalog);
  const anchor = catalog.projects.image_demo.tasks.annotating.recording_anchors?.primary_vehicle;
  if (!anchor) {
    throw new Error("[smart-scribble] image_demo.annotating 缺少 primary_vehicle 语义锚点");
  }
  await page.getByTitle("展开标注详情").click();
  const sourceRow = page.getByTestId(`box-list-item-${sourceAnnotationId}`);
  await sourceRow.waitFor({ state: "visible", timeout: 15_000 });
  await sourceRow.click();
  const collapseSelection = page.getByLabel("收起浮窗");
  await collapseSelection.waitFor({ state: "visible", timeout: 5_000 });
  await collapseSelection.click();
  await page.getByTitle("收起标注详情").click();
  await page.getByTitle("展开标注详情").waitFor({ state: "visible", timeout: 10_000 });

  const tool = page.getByTestId("tool-btn-smart-scribble");
  await tool.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const button = document.querySelector<HTMLElement>('[data-testid="tool-btn-smart-scribble"]');
      return (
        button &&
        !button.hasAttribute("disabled") &&
        button.getAttribute("aria-disabled") !== "true"
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  if (!(await tool.isEnabled())) {
    throw new Error("[smart-scribble] 已存 Mask 选中后智能笔迹仍不可用");
  }

  await page.getByTitle("适应视口（双击空白）").click();
  await page.getByText("分辨率 1280×720", { exact: true }).waitFor({ timeout: 5_000 });
  // “适应视口”取决于工作台可用尺寸；4K 营销录制保持 1440×810 逻辑视口，
  // 因而正确的 fit zoom 是 136% 而非固定 100%。这里只验证缩放状态已稳定显示。
  await page.getByText(/^\d+%$/).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(800);

  const stage = page.getByTestId("workbench-stage");
  const box = await renderedMediaBounds(stage);
  const point = (x: number, y: number) => mediaPoint(box, [x, y]);

  const drawStartMs = Date.now();
  await tool.click();
  await page.getByTestId("interactive-toolbar").waitFor({ state: "visible" });
  await page.getByTestId("mask-prompt-source").waitFor({ state: "visible" });
  await page.waitForTimeout(650);

  const [positiveStartAnchor, positiveEndAnchor] = anchor.positive_stroke;
  if (!positiveStartAnchor || !positiveEndAnchor) {
    throw new Error("[smart-scribble] primary_vehicle 缺少正向笔迹锚点");
  }
  const positiveStart = point(...positiveStartAnchor);
  const positiveEnd = point(...positiveEndAnchor);
  const positiveResponse = page.waitForResponse((response) =>
    response.url().endsWith("/interactive-annotating"),
  );
  await page.mouse.move(positiveStart.x, positiveStart.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, positiveStart, positiveEnd, 700);
  await page.mouse.up();
  if ((await positiveResponse).status() !== 200) {
    throw new Error("[smart-scribble] 正向笔迹推理失败");
  }
  await page.getByText("候选待处理", { exact: true }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);

  const polarity = page.getByTestId("ai-tool-polarity");
  await polarity.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ai-tool-polarity"]')
        ?.getAttribute("title")
        ?.includes("负向"),
    undefined,
    { timeout: 3_000 },
  );

  const [negativeStartAnchor, negativeEndAnchor] = anchor.negative_stroke;
  if (!negativeStartAnchor || !negativeEndAnchor) {
    throw new Error("[smart-scribble] primary_vehicle 缺少负向笔迹锚点");
  }
  const negativeStart = point(...negativeStartAnchor);
  const negativeEnd = point(...negativeEndAnchor);
  const negativeResponse = page.waitForResponse((response) =>
    response.url().endsWith("/interactive-annotating"),
  );
  await page.mouse.move(negativeStart.x, negativeStart.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, negativeStart, negativeEnd, 700);
  await page.mouse.up();
  if ((await negativeResponse).status() !== 200) {
    throw new Error("[smart-scribble] 负向笔迹推理失败");
  }
  await page.waitForTimeout(1_200);

  const scribbleContexts = promptContexts.filter((context) => context.type === "scribble");
  if (scribbleContexts.length !== 2) {
    throw new Error(`[smart-scribble] 期望 2 次笔迹推理，实际 ${scribbleContexts.length} 次`);
  }
  const polarities = scribbleContexts.map((context) => {
    const strokes = Array.isArray(context.scribbles) ? context.scribbles : [];
    return strokes.map((stroke) =>
      typeof stroke === "object" && stroke !== null && "polarity" in stroke
        ? (stroke as { polarity: unknown }).polarity
        : null,
    );
  });
  if (polarities[0]?.at(-1) !== 1 || polarities[1]?.at(-1) !== 0) {
    throw new Error(`[smart-scribble] 正负笔迹顺序异常：${JSON.stringify(polarities)}`);
  }

  await page.getByText("候选待处理", { exact: true }).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(1_000);
  await page.keyboard.press("Enter");
  await commitPendingAnnotationClass(page, {
    label: anchor.label,
    taskId: catalog.projects.image_demo.tasks.annotating.id,
  });
  await page.waitForTimeout(2_000);

  return { drawStartMs, drawEndMs: Date.now() };
}
