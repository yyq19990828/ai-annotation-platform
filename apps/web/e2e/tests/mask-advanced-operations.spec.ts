import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

import { expect, test, type SeedAPI, type SeedData } from "../fixtures/seed";

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";
const IMAGE_WIDTH = 64;
const IMAGE_HEIGHT = 48;

interface MaskReference {
  encoding: "coco_rle_ref";
  size: [number, number];
  object_key: string;
  sha256: string;
  runs: number;
  bytes: number;
}

interface CocoRle {
  encoding: "coco_rle";
  size: [number, number];
  counts: number[];
}

interface AnnotationDto {
  id: string;
  annotation_type: string;
  class_name: string;
  geometry: { type: string; mask?: MaskReference };
  is_active: boolean;
  is_locked: boolean;
  version: number;
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${response.request().method()} ${response.url()} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function annotations(
  request: APIRequestContext,
  taskId: string,
  token: string,
): Promise<AnnotationDto[]> {
  return json<AnnotationDto[]>(
    await request.get(`${API_BASE}/api/v1/tasks/${taskId}/annotations`, { headers: auth(token) }),
  );
}

async function maskContent(
  request: APIRequestContext,
  annotationId: string,
  token: string,
): Promise<CocoRle> {
  return json<CocoRle>(
    await request.get(`${API_BASE}/api/v1/annotations/${annotationId}/mask-content`, {
      headers: auth(token),
    }),
  );
}

function foregroundArea(rle: CocoRle): number {
  return rle.counts.reduce((area, count, index) => area + (index % 2 === 1 ? count : 0), 0);
}

async function openTask(page: Page, seed: SeedAPI, data: SeedData, taskId: string): Promise<void> {
  await seed.configureRasterMask(data.project_id, true);
  await seed.advanceTask({
    taskId,
    toStatus: "pending",
    annotatorEmail: data.annotator_email,
  });
  await seed.injectToken(page, data.annotator_email);
  await page.goto(`/projects/${data.project_id}/annotate?task=${taskId}`);
  await expect(page.getByTestId("workbench-stage")).toBeVisible({ timeout: 15_000 });
}

async function beginEdit(page: Page, annotationId: string): Promise<void> {
  const row = page.getByTestId(`box-list-item-${annotationId}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  // 浮动选中卡可能合法覆盖右侧列表；强制派发列表选择事件，随后仍从可见操作按钮进入编辑。
  // 编辑按钮必须取目标行专属的 user-refine-{id} (dispatchEvent 绕过 hover 浮出)：
  // 多 mask 场景下全局 :visible 的「编辑 Mask」按钮可能属于其他行，导致编辑了错误对象。
  await row.click({ force: true });
  await page.getByTestId(`user-refine-${annotationId}`).dispatchEvent("click");
  await expect(page.getByTestId("mask-toolbar")).toContainText("就绪", { timeout: 15_000 });
  // 就绪 ≠ 画布可交互：等媒体与 Konva 画布真正可见后再让用例做指针操作，
  // 否则 fitted 前的合成指针事件被丢弃, 笔迹无声丢失。
  const stage = page.getByTestId("workbench-stage");
  await expect(stage).toHaveAttribute("data-image-ready", "true", { timeout: 15_000 });
  await expect(stage.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
}

async function imagePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("workbench-stage").boundingBox();
  if (!box) throw new Error("workbench stage has no bounding box");
  const scale = Math.min(box.width / IMAGE_WIDTH, box.height / IMAGE_HEIGHT);
  const left = box.x + (box.width - IMAGE_WIDTH * scale) / 2;
  const top = box.y + (box.height - IMAGE_HEIGHT * scale) / 2;
  return {
    x: left + (x + 0.5) * scale,
    y: top + (y + 0.5) * scale,
  };
}

async function clickPixel(page: Page, x: number, y: number): Promise<void> {
  const point = await imagePoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function waitToastsGone(page: Page): Promise<void> {
  // sonner toast 挂在页面右上 (section[aria-live])，beginEdit 的提示 toast 会盖住
  // 画布上部区域的笔迹落点，mousedown 被 toast 截获 → 整笔无声丢失。
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
}

async function paintStroke(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await waitToastsGone(page);
  const start = await imagePoint(page, from[0], from[1]);
  const end = await imagePoint(page, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function drawLasso(page: Page, points: Array<[number, number]>): Promise<void> {
  const [first, ...rest] = await Promise.all(points.map(([x, y]) => imagePoint(page, x, y)));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.mouse.up();
}

async function openAdvanced(page: Page): Promise<void> {
  await page.getByTestId("mask-toolbar").getByTitle("Mask 高级工具").click();
}

async function chooseAdvanced(page: Page, name: string | RegExp): Promise<void> {
  await openAdvanced(page);
  await page.getByRole("menuitem", { name }).click();
  await expect(page.locator('[role="menu"]:visible')).toHaveCount(0);
}

async function chooseAdvancedRadio(page: Page, name: string): Promise<void> {
  await openAdvanced(page);
  await page.getByRole("menuitemradio", { name }).click();
  await expect(page.locator('[role="menu"]:visible')).toHaveCount(0);
}

async function applyPreview(page: Page): Promise<void> {
  await page.getByTestId("mask-toolbar").getByRole("button", { name: "应用预览" }).click();
}

test.describe("v0.23.9 Mask 高级编辑发布矩阵", () => {
  test("1. 非正方形图片的方笔刷、圆橡皮、lasso 与 undo/redo 刷新后逐像素一致", async ({
    page,
    request,
    seed,
  }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const fixture = await seed.injectRasterMask({ taskId, userEmail: data.annotator_email });
    const token = await seed.accessToken(data.annotator_email);
    const before = await maskContent(request, fixture.annotation_id, token);
    await openTask(page, seed, data, taskId);
    await beginEdit(page, fixture.annotation_id);

    const toolbar = page.getByTestId("mask-toolbar");
    await toolbar.getByTestId("mask-radius-slider").fill("2");
    await chooseAdvancedRadio(page, "方形硬边");
    await paintStroke(page, [50, 8], [55, 13]);

    await chooseAdvancedRadio(page, "圆形硬边");
    await toolbar.getByRole("radio", { name: "橡皮" }).click();
    await paintStroke(page, [20, 18], [24, 18]);

    await toolbar.getByRole("radio", { name: "套索添加" }).click();
    await drawLasso(page, [
      [2, 32],
      [8, 32],
      [8, 40],
      [2, 40],
      [2, 32],
    ]);
    await expect(toolbar).toContainText("套索添加");
    await applyPreview(page);

    await toolbar.getByRole("radio", { name: "套索扣除" }).click();
    await drawLasso(page, [
      [30, 18],
      [36, 18],
      [36, 26],
      [30, 26],
      [30, 18],
    ]);
    await expect(toolbar).toContainText("套索扣除");
    await applyPreview(page);
    await expect(toolbar).toContainText("未保存");

    await page.keyboard.press("Control+z");
    await expect(toolbar.getByTitle("重做笔画 (Ctrl+Y)")).toBeEnabled();
    await page.keyboard.press("Control+y");
    await expect(toolbar.getByTitle("撤销笔画 (Ctrl+Z)")).toBeEnabled();

    const savedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/tasks/${taskId}/annotations/${fixture.annotation_id}`) &&
        response.request().method() === "PATCH" &&
        response.ok(),
    );
    await toolbar.getByRole("button", { name: "确认", exact: true }).click();
    await savedResponse;
    const saved = await maskContent(request, fixture.annotation_id, token);
    expect(saved.counts).not.toEqual(before.counts);

    await page.reload();
    await expect(page.getByTestId(`box-list-item-${fixture.annotation_id}`)).toBeVisible({
      timeout: 15_000,
    });
    expect(await maskContent(request, fixture.annotation_id, token)).toEqual(saved);
  });

  test("2. 4/8 邻域与 flood fill 只修改命中的连通区域", async ({ page, request, seed }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const fixture = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      variant: "diagonal_two",
    });
    const token = await seed.accessToken(data.annotator_email);
    await openTask(page, seed, data, taskId);
    await beginEdit(page, fixture.annotation_id);
    const toolbar = page.getByTestId("mask-toolbar");

    await chooseAdvanced(page, "保留命中组件");
    await clickPixel(page, 20, 20);
    await expect(toolbar).toContainText("面积 32→16");
    await expect(toolbar).toContainText("组件 2→1");
    await toolbar.getByRole("button", { name: "取消预览" }).click();

    await chooseAdvancedRadio(page, "8 邻域");
    await chooseAdvanced(page, "保留命中组件");
    await clickPixel(page, 20, 20);
    await expect(toolbar).toContainText("变化 0 px");
    await expect(toolbar).toContainText("面积 32→32");
    await expect(toolbar).toContainText("组件 1→1");
    await toolbar.getByRole("button", { name: "取消预览" }).click();

    await chooseAdvancedRadio(page, "4 邻域");
    await chooseAdvanced(page, "擦除命中区域");
    await clickPixel(page, 20, 20);
    await expect(toolbar).toContainText("面积 32→16");
    await applyPreview(page);
    const savedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/tasks/${taskId}/annotations/${fixture.annotation_id}`) &&
        response.request().method() === "PATCH" &&
        response.ok(),
    );
    await toolbar.getByRole("button", { name: "确认", exact: true }).click();
    await savedResponse;
    expect(foregroundArea(await maskContent(request, fixture.annotation_id, token))).toBe(16);
  });

  test("3. donut 与小岛的 hole、去小组件、keep 预览准确且取消不改持久内容", async ({
    page,
    request,
    seed,
  }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const fixture = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      variant: "donut_three",
    });
    const token = await seed.accessToken(data.annotator_email);
    const persisted = await maskContent(request, fixture.annotation_id, token);
    await openTask(page, seed, data, taskId);
    await beginEdit(page, fixture.annotation_id);
    const toolbar = page.getByTestId("mask-toolbar");

    await chooseAdvanced(page, "填充命中孔洞");
    await clickPixel(page, 10, 10);
    await expect(toolbar).toContainText("面积 612→676");
    await expect(toolbar).toContainText("孔洞 1→0");
    await toolbar.getByRole("button", { name: "取消预览" }).click();
    expect(await maskContent(request, fixture.annotation_id, token)).toEqual(persisted);

    await openAdvanced(page);
    await page.getByLabel("组件与孔洞面积阈值").fill("180");
    await page.getByRole("menuitem", { name: /去除小组件/ }).click();
    await expect(toolbar).toContainText("面积 612→456");
    await expect(toolbar).toContainText("组件 3→2");
    await toolbar.getByRole("button", { name: "取消预览" }).click();

    await chooseAdvanced(page, "保留命中组件");
    await clickPixel(page, 5, 5);
    await expect(toolbar).toContainText("面积 612→260");
    await expect(toolbar).toContainText("组件 3→1");
    await applyPreview(page);
    await expect(toolbar).toContainText("未保存");
    await toolbar.getByRole("button", { name: "取消", exact: true }).click();
    await expect(toolbar).toBeHidden();
    expect(await maskContent(request, fixture.annotation_id, token)).toEqual(persisted);
  });

  test("4. 1080p 实际 Worker 可完成、可取消且失败不修改输入", async ({ page, seed }) => {
    test.skip(
      Boolean(process.env.CI) && !process.env.PLAYWRIGHT_RASTER_MASK_MATRIX,
      "源码 Worker 模块需由 Vite 开发服务提供，在 native Mask 矩阵执行",
    );
    test.setTimeout(90_000);
    const data = await seed.reset();
    await seed.injectToken(page, data.admin_email);
    await page.goto("/dashboard");

    const result = await page.evaluate(async () => {
      const compute = await import("/src/pages/Workbench/stage/shared/rasterMaskCompute.ts");
      const codec = await import("/src/pages/Workbench/stage/shared/geometry/maskRle.ts");
      const width = 1920;
      const height = 1080;
      const alpha = new Uint8Array(width * height);
      for (let y = 400; y < 680; y += 1) {
        alpha.fill(255, y * width + 700, y * width + 1220);
      }
      const rle = codec.encodeCocoRle(alpha, width, height);
      const originalCounts = [...rle.counts];
      const completed = await compute.executeRasterMaskOperationAsync(
        rle,
        { type: "morphology", operation: "erode", kernelShape: "disk", radius: 2 },
        { sessionId: "e2e-worker", generation: 1, operationId: 1 },
      );

      const controller = new AbortController();
      const cancelledPromise = compute.executeRasterMaskOperationAsync(
        rle,
        { type: "morphology", operation: "close", kernelShape: "disk", radius: 32 },
        { sessionId: "e2e-worker", generation: 1, operationId: 2 },
        { signal: controller.signal },
      );
      controller.abort();
      let cancelledName = "";
      try {
        await cancelledPromise;
      } catch (error) {
        cancelledName = error instanceof Error ? error.name : String(error);
      }

      let failingWorker: {
        onmessage: ((event: MessageEvent) => void) | null;
        onerror: ((event: { message: string }) => void) | null;
        postMessage: () => void;
        terminate: () => void;
      };
      const failurePromise = compute.executeRasterMaskOperationAsync(
        rle,
        { type: "fill_holes", mode: "all" },
        { sessionId: "e2e-worker", generation: 1, operationId: 3 },
        {
          createWorker: () => {
            failingWorker = {
              onmessage: null,
              onerror: null,
              postMessage: () =>
                queueMicrotask(() => failingWorker.onerror?.({ message: "forced worker failure" })),
              terminate: () => undefined,
            };
            return failingWorker as unknown as Worker;
          },
        },
      );
      let failureName = "";
      let failureMessage = "";
      try {
        await failurePromise;
      } catch (error) {
        failureName = error instanceof Error ? error.name : String(error);
        failureMessage = error instanceof Error ? error.message : String(error);
      }
      return {
        completedContext: completed.context,
        completedArea: completed.result.report.afterArea,
        cancelledName,
        failureName,
        failureMessage,
        inputUnchanged: JSON.stringify(rle.counts) === JSON.stringify(originalCounts),
      };
    });

    expect(result.completedContext).toEqual({
      sessionId: "e2e-worker",
      generation: 1,
      operationId: 1,
    });
    expect(result.completedArea).toBeGreaterThan(0);
    expect(result.cancelledName).toBe("RasterMaskWorkerCancelledError");
    expect(result.failureName).toBe("RasterMaskWorkerError");
    expect(result.failureMessage).toContain("forced worker failure");
    expect(result.inputUnchanged).toBe(true);
  });

  test("5. split 冲突整批 409 无部分写入，刷新后原子提交并保留 lineage", async ({
    page,
    request,
    seed,
  }) => {
    test.setTimeout(90_000);
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const fixture = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      variant: "donut_three",
    });
    const token = await seed.accessToken(data.annotator_email);
    await openTask(page, seed, data, taskId);
    await beginEdit(page, fixture.annotation_id);
    const toolbar = page.getByTestId("mask-toolbar");

    await chooseAdvanced(page, "拆分全部组件（保留最大）");
    await expect(toolbar).toContainText("1 个来源 → 3 个结果");
    const source = (await annotations(request, taskId, token))[0];
    const bumped = await request.patch(
      `${API_BASE}/api/v1/tasks/${taskId}/annotations/${source.id}`,
      {
        headers: { ...auth(token), "If-Match": `W/"${source.version}"` },
        data: { geometry: source.geometry },
      },
    );
    expect(bumped.ok(), await bumped.text()).toBe(true);

    const conflicted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/tasks/${taskId}/annotations/mask-mutations:commit`) &&
        response.request().method() === "POST",
    );
    await toolbar.getByRole("button", { name: "原子提交" }).click();
    const conflictResponse = await conflicted;
    expect(conflictResponse.status()).toBe(409);
    await expect(toolbar.getByRole("alert")).toContainText("来源 Mask 已变更");
    expect(await annotations(request, taskId, token)).toHaveLength(1);

    await toolbar.getByRole("button", { name: "刷新范围" }).click();
    await expect(toolbar).toContainText("1 个来源 → 3 个结果", { timeout: 15_000 });
    const committed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/tasks/${taskId}/annotations/mask-mutations:commit`) &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await toolbar.getByRole("button", { name: "原子提交" }).click();
    const body = await json<{
      created_annotations: Array<{ id: string }>;
      lineage_edges: Array<{ source_annotation_id: string }>;
    }>(await committed);
    expect(body.created_annotations).toHaveLength(2);
    expect(body.lineage_edges.every((edge) => edge.source_annotation_id === source.id)).toBe(true);
    await expect.poll(async () => (await annotations(request, taskId, token)).length).toBe(3);
  });

  test("6a. join 保留 hole/小岛与 lineage", async ({ page, request, seed }) => {
    test.setTimeout(90_000);
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const donut = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      variant: "donut_three",
    });
    const island = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      variant: "island",
    });
    const token = await seed.accessToken(data.annotator_email);
    await openTask(page, seed, data, taskId);
    const donutRow = page.getByTestId(`box-list-item-${donut.annotation_id}`);
    const islandRow = page.getByTestId(`box-list-item-${island.annotation_id}`);
    await donutRow.click({ force: true });
    await islandRow.dispatchEvent("click", { shiftKey: true });
    await expect(donutRow).toHaveClass(/!border-brand/);
    await expect(islandRow).toHaveClass(/!border-brand/);
    await page.getByTestId(`user-refine-${island.annotation_id}`).dispatchEvent("click");
    const toolbar = page.getByTestId("mask-toolbar");
    await expect(toolbar).toContainText("就绪", { timeout: 15_000 });
    await expect(donutRow).toHaveClass(/!border-brand/);
    await expect(islandRow).toHaveClass(/!border-brand/);
    await openAdvanced(page);
    const joinItem = page.getByRole("menuitem", { name: "合并为副本（保留来源）" });
    await expect(joinItem).toBeEnabled();
    await joinItem.click();
    await expect(page.locator('[role="menu"]:visible')).toHaveCount(0);
    await expect(toolbar).toContainText("2 个来源 → 1 个结果");
    await expect(toolbar).toContainText("保留 2 个来源");
    const joined = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/tasks/${taskId}/annotations/mask-mutations:commit`) &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await toolbar.getByRole("button", { name: "原子提交" }).click();
    const joinBody = await json<{
      created_annotations: Array<{ id: string }>;
      lineage_edges: Array<{ source_annotation_id: string }>;
    }>(await joined);
    expect(joinBody.created_annotations).toHaveLength(1);
    expect(new Set(joinBody.lineage_edges.map((edge) => edge.source_annotation_id))).toEqual(
      new Set([donut.annotation_id, island.annotation_id]),
    );
    const joinedId = joinBody.created_annotations[0].id;
    const joinedRow = page.getByTestId(`box-list-item-${joinedId}`);
    await expect(joinedRow).toContainText("4 组件", { timeout: 15_000 });
    await expect(joinedRow).toContainText("1 孔洞");
    expect(await annotations(request, taskId, token)).toHaveLength(3);
  });

  test("6b. 锁定重叠对象阻止严格提交", async ({ page, seed }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const primary = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
    });
    await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      locked: true,
    });
    await openTask(page, seed, data, taskId);
    await beginEdit(page, primary.annotation_id);
    const lockedToolbar = page.getByTestId("mask-toolbar");
    await chooseAdvanced(page, "预览同类严格非重叠");
    await expect(lockedToolbar).toContainText("未解决 1 个");
    await expect(lockedToolbar.getByRole("alert")).toContainText("锁定");
    await expect(lockedToolbar.getByRole("button", { name: "原子提交" })).toBeDisabled();
  });

  test("7. 默认允许重叠；erase_same_class 只修改同类当前媒体对象", async ({
    page,
    request,
    seed,
  }) => {
    test.setTimeout(90_000);
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const primary = await seed.injectRasterMask({ taskId, userEmail: data.annotator_email });
    const sameClass = await seed.injectRasterMask({ taskId, userEmail: data.annotator_email });
    const otherClass = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      label: "person",
    });
    const token = await seed.accessToken(data.annotator_email);
    const sameBefore = await maskContent(request, sameClass.annotation_id, token);
    const otherBefore = await maskContent(request, otherClass.annotation_id, token);
    await openTask(page, seed, data, taskId);
    await beginEdit(page, primary.annotation_id);
    const toolbar = page.getByTestId("mask-toolbar");
    const radiusSlider = toolbar.getByTestId("mask-radius-slider");
    await radiusSlider.fill("2");
    // 显式锁定笔刷形状 (默认即圆形): 与用例 1 相同的交互节奏, 让 slider/形状菜单的
    // 渲染在画笔落下前完成, 避免过渡帧里 stage 几何与 Konva vp 不一致导致笔迹落空。
    await expect(radiusSlider).toHaveValue("2");
    await radiusSlider.blur();
    await chooseAdvancedRadio(page, "圆形硬边");
    // 起笔点 (50,8) 在浮动选择面板 (fixed, 默认停靠右上, 覆盖画布图片内 x>=51 区域)
    // 之外: 落点被浮层截获时 mousedown 不会到达画布, 整笔无声丢失且不置 dirty。
    await paintStroke(page, [50, 8], [55, 13]);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/tasks/${taskId}/annotations/${primary.annotation_id}`) &&
        response.request().method() === "PATCH" &&
        response.ok(),
    );
    await toolbar.getByRole("button", { name: "确认", exact: true }).click();
    await saved;
    await expect(toolbar).toContainText("未激活", { timeout: 10_000 });
    await page.keyboard.press("v");
    await expect(toolbar).toBeHidden();
    expect(await maskContent(request, sameClass.annotation_id, token)).toEqual(sameBefore);
    expect(await maskContent(request, otherClass.annotation_id, token)).toEqual(otherBefore);

    await beginEdit(page, primary.annotation_id);
    await chooseAdvanced(page, "预览同类严格非重叠");
    const strictToolbar = page.getByTestId("mask-toolbar");
    await expect(strictToolbar).toContainText("删除 1 个");
    await strictToolbar.getByRole("button", { name: "原子提交" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("确认删除 1 个 Mask 实例");
    const committed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/tasks/${taskId}/annotations/mask-mutations:commit`) &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await confirm.getByRole("button", { name: "确认删除并提交" }).click();
    const body = await json<{ deleted_annotation_ids: string[] }>(await committed);
    expect(body.deleted_annotation_ids).toContain(sameClass.annotation_id);
    expect(body.deleted_annotation_ids).not.toContain(otherClass.annotation_id);
    const remaining = await annotations(request, taskId, token);
    expect(remaining.some((item) => item.id === sameClass.annotation_id)).toBe(false);
    expect(remaining.some((item) => item.id === otherClass.annotation_id)).toBe(true);
    expect(await maskContent(request, otherClass.annotation_id, token)).toEqual(otherBefore);
  });

  test("14. 锁定对象的 toolbar、快捷键和原子 API 均拒绝高级操作", async ({
    page,
    request,
    seed,
  }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    const fixture = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
      locked: true,
    });
    const token = await seed.accessToken(data.annotator_email);
    await openTask(page, seed, data, taskId);
    await page.getByTestId(`box-list-item-${fixture.annotation_id}`).click();
    await page.keyboard.press("m");
    const toolbar = page.getByTestId("mask-toolbar");
    await expect(toolbar).toContainText("不可编辑：当前标注已锁定", { timeout: 15_000 });
    await expect(toolbar.getByTitle("Mask 高级工具")).toBeDisabled();
    await expect(toolbar.getByRole("radio", { name: "套索添加" })).toBeDisabled();

    let mutationRequests = 0;
    page.on("request", (outgoing) => {
      if (outgoing.url().includes("mask-mutations:commit")) mutationRequests += 1;
    });
    await page.keyboard.press("b");
    await page.keyboard.press("e");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    expect(mutationRequests).toBe(0);

    const [source] = await annotations(request, taskId, token);
    const scope = {
      media: "image",
      frame_index: null,
      segment_id: null,
      instance_filter: "same_class",
      class_name: source.class_name,
      overlap_policy: "allow",
      strict_non_overlap: false,
    };
    const fingerprint = await page.evaluate(
      async ({ payloadScope, memberId }) => {
        const canonical = (value: unknown): string => {
          if (value === null || typeof value !== "object") return JSON.stringify(value);
          if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
          const object = value as Record<string, unknown>;
          return `{${Object.keys(object)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
            .join(",")}}`;
        };
        const bytes = new TextEncoder().encode(
          canonical({ scope: payloadScope, members: [memberId] }),
        );
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      },
      { payloadScope: scope, memberId: source.id },
    );
    const rejected = await request.post(
      `${API_BASE}/api/v1/tasks/${taskId}/annotations/mask-mutations:commit`,
      {
        headers: auth(token),
        data: {
          idempotency_key: `e2e-locked-${source.id}`,
          operation: "copy_component",
          scope,
          scope_fingerprint: fingerprint,
          expected_versions: [{ annotation_id: source.id, version: source.version }],
          mutations: [
            {
              kind: "create",
              source_annotation_ids: [source.id],
              geometry: source.geometry,
            },
          ],
          report: { source_areas: [744], result_areas: [744, 744], connectivity: 4 },
        },
      },
    );
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).detail.reason).toBe("annotation_locked");
    expect(await annotations(request, taskId, token)).toHaveLength(1);
  });
});
