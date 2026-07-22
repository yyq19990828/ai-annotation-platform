import type { APIResponse } from "@playwright/test";
import { expect, test } from "../fixtures/seed";

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8000";

interface AnnotationDto {
  id: string;
  annotation_type: string;
  geometry: { type: string };
  version: number;
}

async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.request().method()} ${response.url()} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

test.describe("annotation conversion center", () => {
  test.afterEach(async ({ seed }) => {
    await seed.reset();
  });

  test("polygon copy to Mask, then replace Mask with polygon", async ({ page, request, seed }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    await seed.configureRasterMask(data.project_id, true);
    await seed.advanceTask({
      taskId,
      toStatus: "pending",
      annotatorEmail: data.annotator_email,
    });
    const token = await seed.accessToken(data.annotator_email);
    const headers = { Authorization: `Bearer ${token}` };
    const project = await json<{
      tool_bindings?: { region?: { classes?: Array<{ name: string }> } };
    }>(await request.get(`${API_BASE}/api/v1/projects/${data.project_id}`, { headers }));
    const className = project.tool_bindings?.region?.classes?.[0]?.name;
    if (!className) throw new Error("seed project has no region class");

    const source = await json<AnnotationDto>(await request.post(
      `${API_BASE}/api/v1/tasks/${taskId}/annotations`,
      {
        headers,
        data: {
          annotation_type: "polygon",
          tool_unit_id: "region",
          class_name: className,
          geometry: {
            type: "polygon",
            points: [[0.2, 0.2], [0.7, 0.2], [0.7, 0.7], [0.2, 0.7]],
          },
        },
      },
    ));

    await seed.injectToken(page, data.annotator_email);
    await page.goto(`/projects/${data.project_id}/annotate?task=${taskId}`);
    await expect(page.getByTestId("workbench-stage")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`box-list-item-${source.id}`).click();
    await page.locator('button[aria-label="转为 Mask"]:visible').last().click();

    const dialog = page.getByRole("dialog", { name: "标注转换中心" });
    await expect(dialog).toContainText("Polygon · 1 个对象");
    const dryRun = page.waitForResponse((response) => (
      response.url().endsWith(`/tasks/${taskId}/annotation-conversions:dry-run`)
      && response.request().method() === "POST"
      && response.ok()
    ));
    await dialog.getByRole("button", { name: "生成预览" }).click();
    await dryRun;
    await expect(dialog.getByLabel("转换预览报告")).toContainText("polygon");
    await expect(dialog.getByLabel("转换预览报告")).toContainText("raster_mask");

    const copyExecute = page.waitForResponse((response) => (
      response.url().endsWith(`/tasks/${taskId}/annotation-conversions:execute`)
      && response.request().method() === "POST"
      && response.ok()
    ));
    await dialog.getByRole("button", { name: "执行转换" }).click();
    const copyResult = await json<{
      created_annotations: AnnotationDto[];
    }>(await copyExecute);
    const raster = copyResult.created_annotations[0];
    expect(raster.geometry.type).toBe("raster_mask");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId(`box-list-item-${raster.id}`)).toBeVisible({ timeout: 15_000 });

    await page.locator('button[aria-label="转为矢量几何"]:visible').last().click();
    const replaceDialog = page.getByRole("dialog", { name: "标注转换中心" });
    await replaceDialog.getByLabel("结果策略").click();
    await page.getByRole("option", { name: "替换来源" }).click();
    await replaceDialog.getByRole("button", { name: "生成预览" }).click();
    await expect(replaceDialog.getByLabel("转换预览报告")).toContainText("替换来源");
    await replaceDialog.getByRole("button", { name: "执行转换" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("来源对象会被替换");

    const replaceExecute = page.waitForResponse((response) => (
      response.url().endsWith(`/tasks/${taskId}/annotation-conversions:execute`)
      && response.request().method() === "POST"
      && response.ok()
    ));
    await confirm.getByRole("button", { name: "确认执行" }).click();
    const replaceResult = await json<{
      updated_annotations: AnnotationDto[];
    }>(await replaceExecute);
    expect(replaceResult.updated_annotations[0].id).toBe(raster.id);
    expect(replaceResult.updated_annotations[0].geometry.type).toMatch(/polygon/);

    const annotations = await json<AnnotationDto[]>(await request.get(
      `${API_BASE}/api/v1/tasks/${taskId}/annotations`,
      { headers },
    ));
    expect(annotations).toHaveLength(2);
    expect(annotations.every((annotation) => annotation.geometry.type.includes("polygon"))).toBe(true);
  });
});
