/**
 * v0.16.x · 点云工作台工具/键盘守护(P2 第二刀)。
 *
 * 见 §1 + §5:`usePointMask` 的纠缠正源于"合并的多工具键盘 effect"(B/V/Esc/P/Delete
 * 一个监听器抢占多键)。本 spec 直接钉死这些键盘 handler 的可观测后果(GPU 无关):
 *   ② 放置:B 键切框工具 → 连续创建 20 个 box_3d，保存期拒绝重复 pointer
 *   ③ 删除:点选框 → Delete 键 → handleDeleteSelected → DELETE /annotations/:id
 * 拆 3D 整簇时若动到合并键盘 handler 的结构/次序,这两条立刻报警。
 * 由 `pointcloud` project 跑(WebGL 软渲染)。
 */
import { test, expect } from "../fixtures/seed";

test.describe("workbench pointcloud tools (键盘 handler 守护)", () => {
  test("B 键一次激活 → 连续创建 20 个框 → 保存期串行且 V 退出", async ({ page, seed }) => {
    test.setTimeout(90_000);
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    // 起始 1 框(seed 注入)。
    await expect(page.getByText(/·\s*1\s*框/)).toBeVisible();

    let releaseFirstRequest: (() => void) | null = null;
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let boxPostCount = 0;
    await page.route("**/api/v1/tasks/*/annotations", async (route) => {
      if (route.request().method() === "POST") {
        boxPostCount += 1;
        if (boxPostCount === 1) await firstRequestGate;
      }
      await route.continue();
    });

    // B 键只激活一次，状态条必须明确当前类别、可用手势和退出方式。
    await page.locator("body").click(); // 确保焦点不在输入框
    await page.keyboard.press("b");
    const creationStatus = page.getByTestId("three-d-creation-status");
    await expect(creationStatus).toHaveAttribute("data-phase", "armed");
    await expect(creationStatus).toContainText(/连续建框.*点击放置.*拖框拟合.*V\/Esc 退出/);
    await expect(page.getByTestId("three-d-tool-btn-box")).toHaveAttribute("aria-pressed", "true");

    // 第一次保存故意挂起；期间第二次 pointer 必须被拒绝，不能排成并发 POST。
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas boundingBox 不可用");
    const point = {
      x: box.x + box.width * 0.5,
      y: box.y + box.height * 0.55,
    };
    const firstResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/annotations$/.test(response.url()),
      { timeout: 10_000 },
    );
    await page.mouse.click(point.x, point.y);
    await expect(creationStatus).toHaveAttribute("data-phase", "saving");
    await page.mouse.click(point.x + 24, point.y);
    await page.waitForTimeout(250);
    expect(boxPostCount, "保存期间的第二次 pointer 不得发 POST").toBe(1);
    releaseFirstRequest?.();
    const first = await firstResponse;
    const body = first.request().postDataJSON() as { geometry?: { type?: string } };
    expect(body.geometry?.type).toBe("box_3d");
    await expect(creationStatus).toHaveAttribute("data-phase", "armed");

    // armed 期间点 viewport 内的控件不得误创建；切到 BEV 后第二个框必须走真实拖框自动拟合。
    await page.getByRole("button", { name: "俯视" }).click();
    await page.waitForTimeout(250);
    expect(boxPostCount, "点击 viewport 控件不得创建框").toBe(1);
    const fittedResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/annotations$/.test(response.url()),
      { timeout: 10_000 },
    );
    await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.38);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.62, { steps: 8 });
    await page.mouse.up();
    const fitted = await fittedResponse;
    const fittedBody = fitted.request().postDataJSON() as {
      geometry?: { type?: string; size?: number[] };
    };
    expect(fittedBody.geometry?.type).toBe("box_3d");
    expect(fittedBody.geometry?.size).toHaveLength(3);
    await expect(creationStatus).toHaveAttribute("data-phase", "armed");

    // 同一 armed 会话继续创建到 20 个；每次都等保存完成，验证串行合同。
    for (let index = 2; index < 20; index += 1) {
      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && /\/annotations$/.test(response.url()),
        { timeout: 10_000 },
      );
      await page.mouse.click(point.x + (index % 3) * 8, point.y + (index % 2) * 8);
      await responsePromise;
      await expect(creationStatus).toHaveAttribute("data-phase", "armed");
    }
    expect(boxPostCount).toBe(20);
    await expect(page.getByText(/·\s*21\s*框/)).toBeVisible({ timeout: 10_000 });

    // 新框保持选中，V 明确退出；退出后点击只执行选择，不再创建。
    await expect(page.getByLabel("展开详情")).toBeVisible();
    await page.keyboard.press("v");
    await expect(creationStatus).toHaveCount(0);
    await expect(page.getByTestId("three-d-tool-btn-select")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(250);
    expect(boxPostCount).toBe(20);

    // 每个连续创建结果仍是独立 history entry。
    await page.keyboard.press("Control+z");
    await expect(page.getByText(/·\s*20\s*框/)).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect(page.getByText(/·\s*19\s*框/)).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect(page.getByText(/·\s*20\s*框/)).toBeVisible();
  });

  test("连续建框保存失败 → 回滚半成品并保持 armed 可重试", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    let failNext = true;
    await page.route("**/api/v1/tasks/*/annotations", async (route) => {
      if (route.request().method() === "POST" && failNext) {
        failNext = false;
        await route.fulfill({ status: 500, json: { detail: "e2e create failure" } });
        return;
      }
      await route.continue();
    });

    await page.locator("body").click();
    await page.keyboard.press("b");
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas boundingBox 不可用");
    const point = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.55 };

    const failedResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.status() === 500,
    );
    await page.mouse.click(point.x, point.y);
    await failedResponse;
    const creationStatus = page.getByTestId("three-d-creation-status");
    await expect(creationStatus).toHaveAttribute("data-phase", "error");
    await expect(creationStatus).toContainText("保存失败，请重试");
    await expect(page.locator('[data-testid^="box-list-item-"]')).toHaveCount(1);
    await expect(page.getByTestId("three-d-tool-btn-box")).toHaveAttribute("aria-pressed", "true");

    const retryResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.status() === 201,
    );
    await page.mouse.click(point.x + 12, point.y);
    await retryResponse;
    await expect(creationStatus).toHaveAttribute("data-phase", "armed");
    await expect(page.locator('[data-testid^="box-list-item-"]')).toHaveCount(2);
  });

  test("保存期切任务 → 迟到响应不选中旧框且不污染新任务 history", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");
    const [firstTaskId, secondTaskId] = lidar.lidar_task_ids;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate?task=${firstTaskId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    let releaseRequest: (() => void) | null = null;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route(`**/api/v1/tasks/${firstTaskId}/annotations`, async (route) => {
      if (route.request().method() === "POST") await requestGate;
      await route.continue();
    });
    let deleteCount = 0;
    page.on("request", (request) => {
      if (request.method() === "DELETE" && /\/annotations\//.test(request.url())) deleteCount += 1;
    });

    await page.locator("body").click();
    await page.keyboard.press("b");
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("主点云 canvas boundingBox 不可用");
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
    await expect(page.getByTestId("three-d-creation-status")).toHaveAttribute(
      "data-phase",
      "saving",
    );

    const secondManifest = page.waitForResponse(
      (response) =>
        response.url().includes(`/tasks/${secondTaskId}/point-cloud/manifest`) && response.ok(),
    );
    await page.getByText(/e2e-lidar-.*-1\.pcd/, { exact: true }).click();
    await secondManifest;
    await expect.poll(() => page.url()).toContain(secondTaskId);
    await expect(page.getByTestId("three-d-creation-status")).toHaveCount(0);
    await expect(page.getByTestId("three-d-tool-btn-select")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const oldResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/tasks/${firstTaskId}/annotations`),
    );
    releaseRequest?.();
    const response = await oldResponse;
    const oldCreated = (await response.json()) as { id: string };

    await expect(page.locator('[data-testid^="box-list-item-"]')).toHaveCount(1);
    await expect(page.getByTestId(`box-list-item-${oldCreated.id}`)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    expect(deleteCount, "旧任务迟到成功不得写入新任务 history").toBe(0);
  });

  test("armed 中切换类别 → 下一框使用新类别且不退出", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const payloadClasses: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST" || !/\/annotations$/.test(request.url())) return;
      payloadClasses.push((request.postDataJSON() as { class_name: string }).class_name);
    });

    await page.locator("body").click();
    await page.keyboard.press("b");
    const status = page.getByTestId("three-d-creation-status");
    await expect(status).toContainText("car");
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("主点云 canvas boundingBox 不可用");
    const point = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.55 };

    const firstResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.status() === 201,
    );
    await page.mouse.click(point.x, point.y);
    await firstResponse;
    await page.getByText("pedestrian", { exact: true }).click();
    await expect(status).toContainText("pedestrian");

    const secondResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.status() === 201,
    );
    await page.mouse.click(point.x + 12, point.y);
    await secondResponse;
    expect(payloadClasses).toEqual(["car", "pedestrian"]);
    await expect(status).toHaveAttribute("data-phase", "armed");
    await expect(page.getByTestId("three-d-tool-btn-box")).toHaveAttribute("aria-pressed", "true");
  });

  test("点选框 → Delete 键 → DELETE /annotations/:id", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click({ position: { x: 12, y: 16 } }); // 左侧避开图标

    // 选中后 Delete 键 → handleDeleteSelected → DELETE。
    const delPromise = page.waitForRequest(
      (req) => req.method() === "DELETE" && /\/annotations\/[0-9a-f-]+/.test(req.url()),
      { timeout: 10_000 },
    );
    await page.keyboard.press("Delete");
    await delPromise;

    // 删除后列表里该框消失(0 个 box-list-item)。
    await expect(page.locator('[data-testid^="box-list-item-"]')).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  // ④ point-mask polygon:守护 usePointMask 的纠缠正源 —— polygon 状态(pointMaskPolygonPoints)
  //    在「合并的多工具键盘 effect」里随 Enter 完成 / Esc 清理。拆 usePointMask 时若动到这个
  //    合并 handler 的结构 / 次序,这条立刻报警。
  //    P 切 point-mask → 选「多边形」→ canvas 点 3 点 → Enter 完成 → POST point_mask_3d。
  test("P → 多边形模式 → 画 polygon → Enter → POST point_mask_3d", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    // P 键切 point-mask 工具(走合并键盘 effect:P→onSetThreeDTool("point-mask"))。
    await page.locator("body").click();
    await page.keyboard.press("p");

    // 工具栏出现选点模式下拉 → 切「多边形」(pointMaskSelectMode = "polygon")。
    const modeSelect = page.getByTestId("pointmask-mode-select");
    await expect(modeSelect).toBeVisible({ timeout: 10_000 });
    await modeSelect.selectOption("polygon");

    // canvas 上点 3 点围出大三角形(覆盖中心点云区,确保 selectPointMaskInScreenPolygon 命中点)。
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas boundingBox 不可用");
    const at = (fx: number, fy: number): [number, number] => [
      box.x + box.width * fx,
      box.y + box.height * fy,
    ];
    await page.mouse.click(...at(0.25, 0.3));
    await page.mouse.click(...at(0.75, 0.3));
    await page.mouse.click(...at(0.5, 0.75));

    // Enter 完成多边形(命中合并键盘 effect 的 `e.key === "Enter" && pointMaskPolygonMode` 分支)
    // → finishPointMaskPolygon → applyPointMaskSelection → POST point_mask_3d。
    const postPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/annotations(\?|$)/.test(req.url().split("/api")[1] ?? req.url()),
      { timeout: 10_000 },
    );
    await page.keyboard.press("Enter");
    const post = await postPromise;
    const body = post.postDataJSON() as {
      annotation_type?: string;
      geometry?: { type?: string };
    };
    expect(body.annotation_type).toBe("point_mask_3d");
    expect(body.geometry?.type).toBe("point_mask_3d");
  });

  test("point-mask 多边形双击优先完成绘制，不触发框聚焦", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    await page.locator("body").click();
    await page.keyboard.press("p");
    await page.getByTestId("pointmask-mode-select").selectOption("polygon");

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas boundingBox 不可用");
    const at = (fx: number, fy: number): [number, number] => [
      box.x + box.width * fx,
      box.y + box.height * fy,
    ];
    await page.mouse.click(...at(0.25, 0.3));
    await page.mouse.click(...at(0.75, 0.3));
    const postPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/annotations(\?|$)/.test(req.url().split("/api")[1] ?? req.url()),
      { timeout: 10_000 },
    );
    await page.mouse.dblclick(...at(0.5, 0.75));
    const body = postPromise.then((request) => request.postDataJSON()) as Promise<{
      geometry?: { type?: string };
    }>;
    await expect(body).resolves.toMatchObject({ geometry: { type: "point_mask_3d" } });
  });
});
