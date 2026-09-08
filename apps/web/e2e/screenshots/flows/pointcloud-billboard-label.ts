/**
 * 高清母版：为一个已复核 3D 框启用“轨迹 · 属性”标签内容，随后环绕点云核对
 * billboard 文字在多个观察角度持续正对相机。源框由 spec 在录制窗口前准备并精确清理。
 */
import { expect, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";
import {
  installRecordingWorkbenchLayout,
  waitForRecordingWorkbenchLayout,
} from "./_workbench-layout";

type ViewportBox = { x: number; y: number; width: number; height: number };

export interface PointcloudBillboardSource {
  taskId: string;
  annotationId: string;
  geometry: Record<string, unknown>;
}

async function dragOrbit(
  page: Page,
  box: ViewportBox,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const start = { x: box.x + box.width * from.x, y: box.y + box.height * from.y };
  const end = { x: box.x + box.width * to.x, y: box.y + box.height * to.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await movePointerAtRefreshRate(page, start, end, 950);
  await page.mouse.up();
  await page.waitForTimeout(550);
}

export async function runPointcloudBillboardLabel(
  page: Page,
  catalog: ScreenshotSeedCatalog,
  source?: PointcloudBillboardSource,
): Promise<DrawWindow> {
  const project = catalog.projects.pointcloud_demo;
  const task = project.tasks.frame_000;
  if (source && source.taskId !== task.id) {
    throw new Error("[pointcloud-billboard-label] 录制框任务与截图 catalog 不一致");
  }

  const annotationMutations: string[] = [];
  page.on("request", (request) => {
    if (
      ["POST", "PATCH", "DELETE"].includes(request.method()) &&
      /\/api\/v1\/tasks\/[^/]+\/annotations(?:\/|$)/.test(request.url())
    ) {
      annotationMutations.push(`${request.method()} ${request.url()}`);
    }
  });

  async function readSourceGeometry(): Promise<Record<string, unknown>> {
    if (!source) throw new Error("[pointcloud-billboard-label] 缺少源框上下文");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    if (!token) throw new Error("[pointcloud-billboard-label] 缺少登录凭据");
    const api = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";
    const response = await page.request.get(`${api}/api/v1/tasks/${task.id}/annotations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok()) {
      throw new Error(
        `[pointcloud-billboard-label] 读取源框失败: ${response.status()} ${await response.text()}`,
      );
    }
    const annotations = (await response.json()) as Array<{
      id?: string;
      geometry?: Record<string, unknown>;
    }>;
    const match = annotations.find((annotation) => annotation.id === source.annotationId);
    if (!match?.geometry) {
      throw new Error("[pointcloud-billboard-label] 录制源框已消失");
    }
    return match.geometry;
  }

  const geometryBefore = source ? await readSourceGeometry() : null;
  if (source) expect(geometryBefore).toEqual(source.geometry);

  await installRecordingWorkbenchLayout(page, "both", {
    workspace: { context: "annotate:3d", preset: "standard" },
  });
  await page.goto(`/projects/${project.id}/annotate?task=${task.id}`);
  await page.waitForLoadState("domcontentloaded");

  const viewport = page.getByTestId("pc-viewport");
  await viewport.waitFor({ timeout: 20_000 });
  await waitForRecordingWorkbenchLayout(page, "both");
  await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_500);

  const drawStartMs = Date.now();
  await page.waitForTimeout(2_600);

  await page.getByRole("button", { name: "工作台设置" }).first().click();
  const dialog = page.getByTestId("workbench-settings-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("tab", { name: "标注显示", exact: true }).click();
  const labelContent = page.getByTestId("setting-field-common.labelContent");
  await labelContent.scrollIntoViewIfNeeded();
  await labelContent.getByRole("tab", { name: "轨迹" }).click();
  const attributesSwitch = labelContent
    .locator("label")
    .filter({ hasText: "属性" })
    .getByRole("switch");
  await expect(attributesSwitch).toHaveAttribute("data-state", "unchecked");
  await page.waitForTimeout(1_200);

  // PointCloudScene 用 CanvasTexture 绘制标签。记录切换后的 fillText 文本，确保属性
  // 不只是 UI 开关变更，而是真正进入 WebGL billboard 纹理。
  await page.evaluate(() => {
    const probeWindow = window as typeof window & { __pointcloudLabelTexts?: string[] };
    probeWindow.__pointcloudLabelTexts = [];
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.fillText;
    prototype.fillText = function (text, x, y, maxWidth) {
      probeWindow.__pointcloudLabelTexts?.push(String(text));
      if (maxWidth === undefined) return original.call(this, text, x, y);
      return original.call(this, text, x, y, maxWidth);
    };
  });

  await attributesSwitch.click();
  await expect(attributesSwitch).toHaveAttribute("data-state", "checked");
  await page.waitForFunction(
    () =>
      (
        window as typeof window & { __pointcloudLabelTexts?: string[] }
      ).__pointcloudLabelTexts?.some((text) => text.endsWith("object · 车辆 · 清晰可见")),
    undefined,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(1_800);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(900);

  const box = await viewport.boundingBox();
  if (!box) throw new Error("[pointcloud-billboard-label] 点云视口不可见");

  // 复位到产品定义的斜俯视角，再用真实双击框聚焦，把目标和 billboard 带到镜头中心。
  await page.getByRole("button", { name: "重置视角", exact: true }).click();
  await page.waitForTimeout(1_500);
  // 该种子框在复位视角下投影到视口中部偏上；命中画布上的真实框而不是靠场景探针。
  await page.mouse.dblclick(box.x + box.width * 0.47, box.y + box.height * 0.42);
  await expect(page.getByTestId("three-d-selection-panel").first()).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1_200);

  // 取消选择以移除 gizmo，保留相机焦点与 billboard 标签；后续轨道从视口上方空白处开始，
  // 避免把拖动误解为框的平移/旋转操作。
  await page.mouse.click(box.x + box.width * 0.14, box.y + box.height * 0.18);
  await expect(page.getByTestId("three-d-selection-panel")).toHaveCount(0, { timeout: 5_000 });
  await page.waitForTimeout(700);

  // 轻微拉远保留框体完整，再从远离目标的空白区域连续 orbit，展示标签始终正对相机。
  await page.mouse.move(box.x + box.width * 0.14, box.y + box.height * 0.19);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(700);
  await dragOrbit(page, box, { x: 0.14, y: 0.19 }, { x: 0.3, y: 0.16 });
  await dragOrbit(page, box, { x: 0.3, y: 0.16 }, { x: 0.12, y: 0.24 });
  // 空白处轨道不会改变框几何，保留焦点构图与标签可读性。
  await page.waitForTimeout(1_500);

  if (source) {
    const geometryAfter = await readSourceGeometry();
    expect(geometryAfter).toEqual(geometryBefore);
  }
  expect(annotationMutations).toEqual([]);

  return { drawStartMs, drawEndMs: Date.now() };
}
