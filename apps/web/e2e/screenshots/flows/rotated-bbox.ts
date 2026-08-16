/**
 * 流程录制：旋转框(OBB)绘制 + 旋转。
 *
 * 输出：outputs/flows/rotated-bbox.gif → docs-site/.../workbench/rotated-bbox.gif
 *
 * screenshot catalog 的 image_demo 已绑定 rotated_bbox 工具单位。选「旋转框」工具 → 在画布拖出
 * 轴对齐矩形（提交 angle=0 的 rotated_bbox）→ 抓顶边外侧旋转手柄拖动改 angle。
 * 画布是 Konva canvas，手柄无 DOM 句柄，全程用 page.mouse 坐标操作。
 *
 * 返回 { drawStartMs, drawEndMs }：绘制段的起止时间戳，供 finalize 裁掉开头(隐藏预测)
 * 与结尾(落库等待)，GIF 只保留绘制过程。画完的标注由 flows.spec 的 afterAll 重建截图 seed 清理。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import {
  commitPendingAnnotationClass,
  hidePredictions,
  mediaBbox,
  movePointerAtRefreshRate,
  movePointerPathAtRefreshRate,
  openImageAnnotate,
  recordingAnchor,
  renderedMediaBounds,
  selectActiveClass,
} from "./_canvas";

export interface DrawWindow {
  drawStartMs: number;
  drawEndMs: number;
}

export async function runRotatedBbox(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  await page.waitForTimeout(1400);

  // 准备（不进 GIF）：隐藏满屏预测框 → 选旋转框工具
  await hidePredictions(page);

  const btn = page.getByTestId("tool-btn-rotated-box");
  await btn.click();
  await page.waitForTimeout(900);

  const stage = page.getByTestId("workbench-stage");
  const box = await renderedMediaBounds(stage);
  const anchor = recordingAnchor(catalog, "image_demo", "annotating", "primary_vehicle");
  await selectActiveClass(page, stage, anchor.label);
  const { start, end } = mediaBbox(box, anchor.bbox);
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;
  const halfH = (end.y - start.y) / 2;

  const drawStartMs = Date.now();
  await page.waitForTimeout(1_200);

  // ── 拖出一个轴对齐矩形（左上 → 右下，分步移动让录屏看到拉框过程）──
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(400);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, start, end, 650);
  await page.mouse.up();
  const created = (await commitPendingAnnotationClass(page, {
    label: anchor.label,
    taskId: catalog.projects.image_demo.tasks.annotating.id,
  })) as {
    id?: string;
    task_id?: number;
    class_name?: string;
  };
  if (
    created.task_id !== catalog.projects.image_demo.tasks.annotating.id ||
    created.class_name !== anchor.label
  ) {
    throw new Error("[rotated-bbox] 旋转框未以 car 类别落库");
  }
  await page.waitForTimeout(1_800); // 停留展示画好的旋转框(angle=0)被选中态 + 手柄

  // ── 抓旋转手柄改 angle ──
  // 手柄是 Konva Circle，无 DOM 句柄，但屏幕坐标可精确推算：它在框中心正上方
  // halfH + handleOffset 处（ImageStageShapes：handleY = -hh - 18/scale；18/scale 经
  // scale 补偿后恒为 18 屏幕 px，故与缩放无关）。命中圈带 hitStrokeWidth 容差，盲拖风险已消除。
  // 旋转角算法（ImageStage rotateBox）：deg = atan2(dx, -dy)，正上方为 0°、顺时针为正；
  // 故让光标保持半径 r 绕框中心 (cx,cy) 顺时针扫角，即可把 angle 从 0 拖到 targetDeg。
  const handleOffset = 18;
  const r = halfH + handleOffset;
  await page.mouse.move(cx, cy - r); // 命中正上方手柄
  await page.waitForTimeout(450);
  await page.mouse.down();
  await page.waitForTimeout(200);
  const targetDeg = 35;
  const rotSteps = 14;
  const rotationPath = Array.from({ length: rotSteps + 1 }, (_, i) => {
    const rad = ((targetDeg * i) / rotSteps) * (Math.PI / 180);
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  });
  await movePointerPathAtRefreshRate(page, rotationPath, 750);
  await page.waitForTimeout(700); // 停留展示旋转到位的框
  const rotationSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/annotations/${created.id ?? "missing"}`) &&
      response.ok(),
    { timeout: 20_000 },
  );
  await page.mouse.up();
  await rotationSaved;
  await page.waitForTimeout(2_000); // 等 commit 落库 + 选中态稳定

  const drawEndMs = Date.now();

  // 等 autosave 把新框落库（清理由 flows.spec 的 afterAll 重建截图 seed 完成）
  await page.waitForTimeout(1200);

  return { drawStartMs, drawEndMs };
}
