/**
 * 流程录制：Mask 笔刷涂抹 + 提交。
 *
 * 输出：outputs/flows/mask-draw.gif → docs-site/.../mask-brush/draw-in-progress.gif
 *
 * screenshot catalog 的 image_demo 已绑定 region 工具单位，Mask 笔刷归属 region。选「Mask 笔刷」工具 →
 * 按住左键拖动涂抹（pointerdown 起笔，pointermove 连续涂），来回几笔填出一块区域 → Enter 提交。
 * 提交类型由任务 Mask 能力决定：原生项目落 raster_mask，兼容项目落 polygon。
 * Konva canvas，用 page.mouse 坐标拖动。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(隐藏预测/选工具)与结尾(落库等待)。
 * 画完的 Mask 由 runner 的 finally 精确删除，afterAll 另行恢复截图 seed。
 */
import { expect, type Page, type Request, type Response } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  commitImageDrawing,
  prepareImageDrawing,
  verifySavedImageDrawing,
  type ImageDrawingOptions,
} from "./_image-drawing";
import {
  mediaPoint,
  movePointerPathAtRefreshRate,
  recordingAnchor,
  renderedMediaBounds,
} from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

/** 沿折线连续涂抹，每个浏览器刷新帧推进一次。 */
async function stroke(page: Page, points: Array<{ x: number; y: number }>) {
  const first = points[0];
  if (!first || points.length < 2) throw new Error("[mask-draw] 笔刷路径至少需要两个点");
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await movePointerPathAtRefreshRate(page, points, 1_000);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

export async function runMaskDraw(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  options: ImageDrawingOptions = {},
): Promise<DrawWindow> {
  const invalidMaskRequests: string[] = [];
  const failedMaskResponses: string[] = [];
  const observeRequest = (request: Request) => {
    if (/\/annotations\/tmp_[^/]+\/mask-content/.test(request.url())) {
      invalidMaskRequests.push(request.url());
    }
  };
  const observeResponse = (response: Response) => {
    if (response.url().includes("/mask-content") && !response.ok()) {
      failedMaskResponses.push(`${response.status()} ${response.url()}`);
    }
  };
  page.on("request", observeRequest);
  page.on("response", observeResponse);
  try {
    await prepareImageDrawing(page, catalog);
    await page.waitForTimeout(1400);

    // 准备（不进 GIF）：隐藏预测 → 选 Mask 笔刷

    const btn = page.getByTestId("tool-btn-mask");
    await btn.click();
    await page.waitForTimeout(900);

    const stage = page.getByTestId("workbench-stage");
    const box = await renderedMediaBounds(stage);
    const anchor = recordingAnchor(catalog, "image_demo", "annotating", "primary_vehicle");
    if (anchor.brush_strokes.length === 0) {
      throw new Error("[mask-draw] primary_vehicle 缺少笔刷轨迹锚点");
    }

    const drawStartMs = Date.now();
    await page.waitForTimeout(1_000);

    // ── 两组往返笔迹逐行填出目标，保留“多笔累积”的视觉语义 ──
    const splitAt = Math.ceil(anchor.brush_strokes.length / 2);
    for (const group of [
      anchor.brush_strokes.slice(0, splitAt),
      anchor.brush_strokes.slice(splitAt),
    ]) {
      if (group.length === 0) continue;
      const points = group.flatMap((path, index) => {
        const mapped = path.map((point) => mediaPoint(box, point));
        return index % 2 === 0 ? mapped : mapped.reverse();
      });
      await stroke(page, points);
    }
    await page.waitForTimeout(700); // 停留展示涂好的色块

    // Enter 提交 Mask（实际落库类型由任务能力决定）
    await page.keyboard.press("Enter");
    const created = await commitImageDrawing(page, {
      onCreated: options.onCreated,
      label: anchor.label,
      taskId: catalog.projects.image_demo.tasks.annotating.id,
    });
    const savedRow = page.getByTestId(`box-list-item-${created.id}`);
    expect(created.geometry, "The native Mask fixture must persist a raster mask").toMatchObject({
      type: "raster_mask",
    });
    // Statistics are exposed only after content decoding and render-record creation.
    await expect(savedRow).toContainText(/\d+ px · \d+ 组件 · \d+ 孔洞 · AABB/);
    await expect(savedRow).not.toContainText("load_failed");
    await page.waitForTimeout(2_000);

    const drawEndMs = Date.now();

    // 保留落库后的展示时间；runner 最终精确清理本次标注。
    await page.waitForTimeout(1200);

    await verifySavedImageDrawing(
      page,
      catalog.projects.image_demo.tasks.annotating.id,
      String(created.id),
      ["raster_mask"],
    );

    await expect(savedRow).toContainText(/\d+ px · \d+ 组件 · \d+ 孔洞 · AABB/);
    expect(
      invalidMaskRequests,
      "Temporary annotation IDs must never fetch persisted content",
    ).toEqual([]);
    expect(failedMaskResponses, "Mask content must load before and after reload").toEqual([]);
    return { drawStartMs, drawEndMs };
  } finally {
    page.off("request", observeRequest);
    page.off("response", observeResponse);
  }
}
