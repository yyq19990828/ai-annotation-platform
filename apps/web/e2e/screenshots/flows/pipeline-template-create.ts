/**
 * 高清母版：创建“车辆检测 → 车辆属性分类”公共编排模板。
 *
 * 只表达模板设计与保存，不混入套用项目或发起预标；后两项各自单独录制。
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export interface PipelineTemplateCreateResult extends DrawWindow {
  pipelineId: string;
}

const pointerByPage = new WeakMap<Page, { x: number; y: number }>();

async function moveTo(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("[pipeline-template-create] 目标控件不可见");
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await movePointerAtRefreshRate(page, pointerByPage.get(page) ?? { x: 80, y: 120 }, target, 280);
  pointerByPage.set(page, target);
}

async function chooseOption(page: Page, select: Locator, label: string): Promise<void> {
  await moveTo(page, select);
  const option = select.locator("option").filter({ hasText: label }).first();
  const value = await option.getAttribute("value");
  if (!value) throw new Error(`[pipeline-template-create] 找不到模型选项：${label}`);
  await select.selectOption(value);
  await expect(select).toHaveValue(value);
  await page.waitForTimeout(900);
}

async function clickChip(page: Page, label: string): Promise<void> {
  const chip = page.getByRole("button", { name: label, exact: true }).last();
  await moveTo(page, chip);
  await chip.click();
  await expect(page.getByRole("button", { name: `✓ ${label}`, exact: true }).last()).toBeVisible();
  await page.waitForTimeout(600);
}

export async function runPipelineTemplateCreate(
  page: Page,
  onCreated: (pipelineId: string) => void,
): Promise<PipelineTemplateCreateResult> {
  await page.goto("/ai-pre/pipelines");
  await expect(page.getByRole("heading", { name: "编排库" })).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByLabel("源阶段模型").locator("option").filter({ hasText: "YOLO 目标检测" }),
  ).toHaveCount(1);
  await expect(page.getByText("命名编排库（公共 / 组织）", { exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  const drawStartMs = Date.now();

  const nameInput = page.getByPlaceholder("例如 detect → 车辆属性");
  await moveTo(page, nameInput);
  await nameInput.click();
  await nameInput.pressSequentially("车辆检测 → 车型与颜色", { delay: 55 });
  await expect(nameInput).toHaveValue("车辆检测 → 车型与颜色");
  await page.waitForTimeout(700);

  const scope = page.getByLabel("全局编排可见范围");
  await moveTo(page, scope);
  await scope.selectOption("public");
  await expect(scope).toHaveValue("public");
  await page.waitForTimeout(700);

  await chooseOption(page, page.getByLabel("源阶段模型"), "yolo-backend · YOLO 目标检测");
  for (const label of ["[2] car", "[5] bus", "[7] truck"]) await clickChip(page, label);
  await page.waitForTimeout(1_000);

  const addStage = page.getByTitle("加子阶段（对该阶段产出的每个框继续跑）", {
    exact: true,
  });
  await moveTo(page, addStage);
  await addStage.click();
  await expect(page.getByText("阶段 2 · 参数", { exact: true })).toBeVisible();
  await page.waitForTimeout(900);

  await chooseOption(
    page,
    page.getByLabel("阶段 2 模型"),
    "onnxtools-backend · [专用]车辆属性分类",
  );
  await expect(page.getByText(/分类 · ROI crop · 写回 父框属性/)).toBeVisible();

  for (const label of ["car", "bus", "truck"]) await clickChip(page, label);
  await clickChip(page, "车型");
  await clickChip(page, "颜色");
  await page.waitForTimeout(1_200);

  const save = page.getByRole("button", { name: "保存公共编排" });
  await moveTo(page, save);
  await expect(save).toBeEnabled();
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/project-pipelines(?:\?|$)/.test(response.url()) &&
      response.status() === 201,
    { timeout: 20_000 },
  );
  await save.click();
  const payload = (await (await created).json()) as {
    id?: string;
    name?: string;
    scope?: string;
    stages?: Array<{
      model_id?: string;
      class_filter?: number[];
      parent_class_filter?: string[];
      write?: { keys?: string[] };
    }>;
  };
  if (!payload.id) throw new Error("[pipeline-template-create] 保存响应缺少编排 ID");
  onCreated(payload.id);
  if (
    payload.name !== "车辆检测 → 车型与颜色" ||
    payload.scope !== "public" ||
    payload.stages?.length !== 2 ||
    payload.stages[0]?.model_id !== "detect" ||
    JSON.stringify(payload.stages[0]?.class_filter) !== JSON.stringify([2, 5, 7]) ||
    payload.stages[1]?.model_id !== "vehicle-attr-classify" ||
    JSON.stringify(payload.stages[1]?.parent_class_filter) !==
      JSON.stringify(["car", "bus", "truck"]) ||
    JSON.stringify(payload.stages[1]?.write?.keys) !== JSON.stringify(["vehicle_type", "color"])
  ) {
    throw new Error(`[pipeline-template-create] 保存结果语义不完整：${JSON.stringify(payload)}`);
  }

  await expect(page.getByText("已保存为公共编排", { exact: true })).toBeVisible();
  await expect(page.getByText("2 阶段 · 可在项目预标入口套用", { exact: true })).toBeVisible();
  const row = page.locator("li").filter({ hasText: "车辆检测 → 车型与颜色" }).first();
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText("公共 · 2 阶段 · 已套用 0 次");
  await expect(row.getByRole("button", { name: "加载编辑" })).toBeVisible();
  await page.waitForTimeout(3_000);

  return { pipelineId: payload.id, drawStartMs, drawEndMs: Date.now() };
}
